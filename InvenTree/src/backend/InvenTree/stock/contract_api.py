"""Operator-owned preparation and contract maintenance, with atomic attribution changes."""

# Business messages intentionally use Chinese punctuation.
# ruff: noqa: RUF001

from decimal import Decimal

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction
from django.db.models import Case, CharField, Exists, OuterRef, Q, Sum, Value, When
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from common.models import ProjectCode
from part.models import Part
from stock.models import (
    StockItem,
    StockLocation,
    WmsBusinessChange,
    WmsContract,
    WmsReceipt,
    WmsReceiptDetail,
)
from stock.projects import bind_project
from stock.warranty import (
    MAX_CODE_LENGTH,
    encode_label,
    resolve_label,
    warranty_end,
    warranty_values,
)
from stock.wms import WmsView, clean_json, current_stock_filter, require
from users.oauth2_scopes import get_granular_scope


class ContractBusinessView(WmsView):
    """Allow role-checked operator business edits while native stock writes stay restricted."""

    allow_operator_writes = True
    required_alternate_scopes = {
        **WmsView.required_alternate_scopes,
        'POST': [[get_granular_scope('change', 'stock')]],
    }


class ContractInput(serializers.ModelSerializer):
    """Validate positive defaults and normalized, unique contract numbers."""

    project_id = serializers.PrimaryKeyRelatedField(
        source='project',
        queryset=ProjectCode.objects.filter(active=True),
        required=False,
        allow_null=True,
    )

    def validate(self, attrs):
        """Reject reparenting that would contradict existing document attribution."""
        if not self.instance and not attrs.get('project'):
            raise ValidationError({'project_id': '新建合同必须选择归属项目'})
        if (
            self.instance
            and 'project' in attrs
            and attrs['project'] != self.instance.project
        ):
            project = attrs['project']
            if project is None and self.instance.project_id:
                raise ValidationError('已归属的合同不能清空项目')
            if project and (
                self.instance.receipts.exclude(project_code=project).exists()
                or self.instance.details.exclude(project_code=project).exists()
            ):
                raise ValidationError('合同历史单据存在其他或未确认项目，请先核对归属')
        return attrs

    class Meta:
        """Writable contract business fields."""

        model = WmsContract
        fields = [
            'number',
            'acceptance_date',
            'warranty_months',
            'active',
            'project_id',
        ]

    def validate_number(self, value):
        """Trim before enforcing uniqueness."""
        value = value.strip()
        query = WmsContract.objects.filter(number=value)
        if self.instance:
            query = query.exclude(pk=self.instance.pk)
        if not value or query.exists():
            raise ValidationError('合同号必填且不能重复')
        return value


class DetailInput(serializers.ModelSerializer):
    """Validate a prepared line without creating inventory."""

    part = serializers.PrimaryKeyRelatedField(
        queryset=Part.objects.filter(active=True, trackable=False)
    )

    class Meta:
        """Dates and warranty terms are maintained on the contract."""

        model = WmsReceiptDetail
        fields = ['part', 'prepared_quantity']

    def to_internal_value(self, data):
        """Do not silently accept obsolete per-item warranty edits."""
        reject_warranty_overrides(data)
        return super().to_internal_value(data)


class ContractWriteInput(ContractInput):
    """Document optional update, impact preview and concurrency fields."""

    pk = serializers.IntegerField(required=False, min_value=1)
    preview = serializers.BooleanField(required=False)
    reason = serializers.CharField(required=False, max_length=2000)
    expected_updated_at = serializers.CharField(required=False)

    class Meta(ContractInput.Meta):
        """Updates require the last read timestamp and a reason."""

        fields = [
            *ContractInput.Meta.fields,
            'pk',
            'preview',
            'reason',
            'expected_updated_at',
        ]


class LabelResolveInput(serializers.Serializer):
    """Resolve the full label in optional preparation and actual location context."""

    barcode = serializers.CharField(max_length=MAX_CODE_LENGTH)
    receipt = serializers.IntegerField(required=False, min_value=1)
    location = serializers.IntegerField(required=False, min_value=1)


class ReceiptInput(serializers.Serializer):
    """One project, contract and location for each preparation."""

    request_key = serializers.UUIDField()
    project = serializers.CharField(max_length=100, allow_blank=False, required=False)
    project_id = serializers.IntegerField(min_value=1, required=False)
    contract = serializers.PrimaryKeyRelatedField(
        queryset=WmsContract.objects.filter(active=True)
    )
    location = serializers.PrimaryKeyRelatedField(
        queryset=StockLocation.objects.filter(structural=False)
    )
    details = DetailInput(many=True, allow_empty=False, max_length=100)

    def validate(self, attrs):
        """Bind every new preparation to an existing active project archive."""
        attrs = bind_project(attrs)
        validate_contract_project(attrs['contract'], attrs['project_code'])
        return attrs


class DetailChangeInput(serializers.Serializer):
    """Change attribution; acceptance and warranty belong to the contract."""

    project = serializers.CharField(max_length=100, required=False, allow_blank=False)
    project_id = serializers.IntegerField(min_value=1, required=False)
    contract = serializers.PrimaryKeyRelatedField(
        queryset=WmsContract.objects.all(), required=False
    )
    prepared_quantity = serializers.DecimalField(
        max_digits=15, decimal_places=5, min_value=Decimal('0.00001'), required=False
    )
    reason = serializers.CharField(max_length=2000, allow_blank=False)
    label_version = serializers.IntegerField(min_value=1)

    def validate(self, attrs):
        """Reject item-level dates instead of reporting a misleading success."""
        reject_warranty_overrides(self.initial_data)
        detail = self.context.get('detail')
        same_project = detail and (
            (attrs.get('project') == detail.project)
            or (
                attrs.get('project_id') is not None
                and attrs['project_id'] == detail.project_code_id
            )
        )
        if (
            detail
            and attrs.get('contract')
            and attrs['contract'].pk != detail.contract_id
            and not attrs['contract'].active
        ):
            raise ValidationError('合同已停用，不能用于新归属')
        attrs = bind_project(attrs, required=False, allow_inactive=bool(same_project))
        if detail:
            validate_contract_project(
                attrs.get('contract', detail.contract),
                attrs.get('project_code', detail.project_code),
            )
        return attrs


class ProjectInput(serializers.Serializer):
    """Create a unique warehouse project without granting native settings permissions."""

    code = serializers.CharField(max_length=100, allow_blank=False)
    description = serializers.CharField(
        max_length=200, required=False, allow_blank=True
    )
    active = serializers.BooleanField(required=False)

    def validate_code(self, value):
        """Duplicate project numbers must be selected rather than created again."""
        if (
            ProjectCode.objects.filter(code=value.strip())
            .exclude(pk=getattr(self.instance, 'pk', None))
            .exists()
        ):
            raise ValidationError('项目号已存在，请选择已有项目')
        return value.strip()


class WmsProjects(ContractBusinessView):
    """Expose the shared project archive to warehouse operators."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        """Return reusable active project records independently of current stock."""
        require(request, StockItem, 'view')
        query = ProjectCode.objects.order_by('code')
        if request.query_params.get('all') != 'true':
            query = query.filter(active=True)
        return Response(
            {'results': list(query.values('pk', 'code', 'description', 'active'))}
        )

    @extend_schema(request=ProjectInput, responses={201: OpenApiTypes.OBJECT})
    def post(self, request):
        """Maintain unique project archives without destroying referenced identities."""
        require(request, StockItem, 'change')
        try:
            with transaction.atomic():
                project = None
                if request.data.get('pk'):
                    project = get_object_or_404(
                        ProjectCode.objects.select_for_update(),
                        pk=serializers.IntegerField(min_value=1).run_validation(
                            request.data['pk']
                        ),
                    )
                before = (
                    {
                        'pk': project.pk,
                        'code': project.code,
                        'description': project.description,
                        'active': project.active,
                    }
                    if project
                    else {}
                )
                if request.data.get('action') == 'delete':
                    if not project:
                        raise ValidationError('请选择要删除的项目')
                    project.delete()
                    audit(request.user, 'project_delete', before=before)
                    return Response({'deleted': True})
                serializer = ProjectInput(
                    project, data=request.data, partial=project is not None
                )
                serializer.is_valid(raise_exception=True)
                project = project or ProjectCode()
                for key, value in serializer.validated_data.items():
                    setattr(project, key, value)
                project.save()
                row = {
                    'pk': project.pk,
                    'code': project.code,
                    'description': project.description,
                    'active': project.active,
                }
                audit(
                    request.user,
                    'project_update' if before else 'project_create',
                    before=before,
                    after=row,
                )
        except ProtectedError as exc:
            raise ValidationError('项目已被使用，请停用，不能删除') from exc
        except ModelValidationError as exc:
            raise ValidationError(exc.message_dict) from exc
        except IntegrityError as exc:
            raise ValidationError({'code': '项目号已存在，请选择已有项目'}) from exc
        return Response(row, status=200 if before else 201)


def reject_warranty_overrides(data):
    """A contract has one acceptance/start date and one warranty term."""
    if any(
        field in data
        for field in ('acceptance_date_override', 'warranty_months_override')
    ):
        raise ValidationError(
            '验收日期即合同起始时间，请在合同中统一维护验收日期和质保月数'
        )


def audit(
    user,
    action,
    *,
    contract=None,
    receipt=None,
    detail=None,
    before=None,
    after=None,
    reason='',
):
    """Record business changes in the same transaction as their mutation."""
    WmsBusinessChange.objects.create(
        actor=user,
        action=action,
        contract=contract,
        receipt=receipt,
        detail=detail,
        before=clean_json(before or {}),
        after=clean_json(after or {}),
        reason=reason,
    )


def validate_contract_project(contract, project):
    """Enforce explicit ownership while keeping legacy unassigned contracts usable."""
    if contract.project_id and contract.project_id != getattr(project, 'pk', None):
        raise ValidationError('合同不属于所选项目，请选择该项目的合同')


def contract_row(contract):
    """Include impact counts for a review before changing defaults."""
    return {
        'pk': contract.pk,
        'number': contract.number,
        'project_id': contract.project_id,
        'project': contract.project.code if contract.project_id else '',
        'active': contract.active,
        'acceptance_date': contract.acceptance_date,
        'warranty_months': contract.warranty_months,
        'updated_at': contract.updated_at.isoformat(),
        'acceptance_followers': contract.details.count(),
        'warranty_followers': contract.details.count(),
    }


def detail_row(detail):
    """Expose current effective values separately from immutable event snapshots."""
    from report.label_layout import equipment_label_font_size

    events = (
        detail.events.filter(operation='INBOUND')
        .exclude(outcome='FAILED')
        .order_by('-pk')
    )
    event = events.first()
    totals = events.aggregate(
        received=Sum('requested_quantity', filter=Q(outcome='SUCCESS')),
        pending=Sum('requested_quantity', filter=Q(outcome='PENDING')),
    )
    received_quantity = (totals['received'] or Decimal(0)) + (
        detail.prepared_quantity if detail.legacy else Decimal(0)
    )
    return {
        'pk': detail.pk,
        'receipt': detail.receipt_id,
        'receipt_location': detail.receipt.location_id,
        'part': detail.part_id,
        'equipment': detail.part.IPN or detail.part.barcode,
        'name': detail.part.name,
        'brand': detail.part.brand,
        'specification': detail.part.specification,
        'model_number': detail.part.model_number,
        'units': detail.part.units,
        'label_font_size': equipment_label_font_size(detail.part),
        'project': detail.project,
        'project_id': detail.project_code_id,
        'contract': detail.contract_id,
        'prepared_quantity': detail.prepared_quantity,
        'label_version': detail.label_version,
        'barcode': encode_label(detail),
        'legacy': detail.legacy,
        'cancelled': detail.receipt.cancelled or detail.cancelled,
        'state': 'CANCELLED'
        if detail.receipt.cancelled or detail.cancelled
        else (
            'IN_REQUEST'
            if totals['pending']
            else ('RECEIVED' if detail.legacy or totals['received'] else 'READY')
        ),
        'active_request': event.approval_request_id
        if event and event.outcome == 'PENDING'
        else None,
        'actual_quantity': event.requested_quantity if event else None,
        'received_quantity': received_quantity,
        'pending_quantity': totals['pending'] or Decimal(0),
        **warranty_values(detail),
    }


def receipt_row(receipt):
    """Return resumable preparation with checked and unchecked line states."""
    return {
        'pk': receipt.pk,
        'request_key': str(receipt.request_key),
        'project': receipt.project,
        'project_id': receipt.project_code_id,
        'contract': receipt.contract_id,
        'location': receipt.location_id,
        'operator': receipt.operator_id,
        'cancelled': receipt.cancelled,
        'created_at': receipt.created_at,
        'updated_at': receipt.updated_at.isoformat(),
        'contract_number': receipt.contract.number,
        'location_name': receipt.location.pathstring,
        'details': [
            detail_row(detail)
            for detail in receipt.details.filter(cancelled=False)
            .select_related('part', 'contract', 'receipt')
            .order_by('pk')
        ],
    }


def lock_parts(ids):
    """Use the existing stock service's Part lock as the shared serialization point."""
    list(Part.objects.select_for_update().filter(pk__in=ids).order_by('pk'))


def ensure_changeable(detail):
    """Pending or successful inbound lines have different attribution constraints."""
    if detail.events.filter(outcome='PENDING').exists():
        raise ValidationError('明细存在草稿或待审批申请，请先移除或取消申请')
    items = list(
        StockItem.objects.select_for_update()
        .filter(source_detail=detail)
        .order_by('pk')
    )
    for item in items:
        if item.scan_frozen_quantity() or item.allocation_count():
            raise ValidationError('明细库存存在冻结或业务占用，不能修改归属')
    return items


def require_receipt_owner(receipt, user):
    """Only the owner or an authorized administrator may maintain a receipt."""
    if receipt.operator_id != user.pk and not user.is_superuser:
        raise PermissionDenied('只能维护自己的入库单')


class WmsContracts(ContractBusinessView):
    """Operators can maintain contract data without gaining catalogue edit rights."""

    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        description='Search contracts. Returns results with effective defaults, updated_at and per-field follower counts.',
    )
    def get(self, request):
        """Search contracts, or read one contract and its change history."""
        require(request, StockItem, 'view')
        query = WmsContract.objects.select_related('project').order_by('number')
        if request.query_params.get('project_id'):
            project_id = serializers.IntegerField(min_value=1).run_validation(
                request.query_params['project_id']
            )
            query = query.filter(Q(project_id=project_id) | Q(project__isnull=True))
        if request.query_params.get('active') == 'true':
            query = query.filter(active=True)
        if request.query_params.get('search'):
            query = query.filter(number__icontains=request.query_params['search'])
        return Response({'results': [contract_row(c) for c in query[:500]]})

    @extend_schema(
        request=ContractWriteInput,
        responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT},
        description='Create, preview or update contract defaults. Updates require pk, reason and expected_updated_at; preview=true returns before/after without saving.',
    )
    @transaction.atomic
    def post(self, request):
        """Create a contract or review and update the defaults atomically."""
        require(request, StockItem, 'change')
        instance = None
        if request.data.get('pk'):
            pk = serializers.IntegerField(min_value=1).run_validation(
                request.data['pk']
            )
            seed = get_object_or_404(WmsContract, pk=pk)
            lock_parts(seed.details.values_list('part_id', flat=True))
            instance = WmsContract.objects.select_for_update().get(pk=seed.pk)
        if request.data.get('action') == 'delete':
            if not instance:
                raise ValidationError('请选择要删除的合同')
            if instance.receipts.exists() or instance.details.exists():
                raise ValidationError('合同已被使用，请停用，不能删除')
            before = contract_row(instance)
            instance.delete()
            audit(request.user, 'contract_delete', before=before)
            return Response({'deleted': True})
        serializer = ContractInput(
            instance, data=request.data, partial=instance is not None
        )
        serializer.is_valid(raise_exception=True)
        if instance:
            before = contract_row(instance)
            if request.data.get('preview') is True:
                return Response(
                    {
                        'before': before,
                        'after': clean_json(
                            {
                                key: value.pk if key == 'project' and value else value
                                for key, value in serializer.validated_data.items()
                            }
                        ),
                    }
                )
            if not str(request.data.get('reason', '')).strip():
                raise ValidationError('修改原因必填')
            if (
                request.data.get('expected_updated_at')
                != instance.updated_at.isoformat()
            ):
                raise ValidationError('合同已变化，请刷新并重新核对影响数量')
            renumber = (
                serializer.validated_data.get('number', instance.number)
                != instance.number
            )
            details = list(instance.details.select_for_update().order_by('pk'))
            if renumber:
                for detail in details:
                    ensure_changeable(detail)
            accepted = serializer.validated_data.get(
                'acceptance_date', instance.acceptance_date
            )
            months = serializer.validated_data.get(
                'warranty_months', instance.warranty_months
            )
            warranty_end(accepted, months)
            serializer.save(updated_by=request.user)
            if renumber:
                for detail in details:
                    detail.label_version += 1
                    detail.save(update_fields=['label_version', 'updated_at'])
            audit(
                request.user,
                'contract_update',
                contract=instance,
                before=before,
                after=contract_row(instance),
                reason=request.data['reason'],
            )
        else:
            instance = serializer.save(created_by=request.user, updated_by=request.user)
            warranty_end(instance.acceptance_date, instance.warranty_months)
            audit(
                request.user,
                'contract_create',
                contract=instance,
                after=contract_row(instance),
            )
        return Response(
            contract_row(instance), status=200 if request.data.get('pk') else 201
        )


class WmsReceipts(ContractBusinessView):
    """Create and recover the current operator's preparation without stock effects."""

    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        description='Return owned preparations with nested detail state, complete barcode, effective warranty and nullable overrides.',
    )
    def get(self, request):
        """Read only owned preparations; administrators may inspect all."""
        require(request, StockItem, 'view')
        query = WmsReceipt.objects.select_related('contract', 'location').order_by(
            '-pk'
        )
        if not request.user.is_superuser:
            query = query.filter(operator=request.user)
        if request.query_params.get('pk'):
            pk = serializers.IntegerField(min_value=1).run_validation(
                request.query_params['pk']
            )
            query = query.filter(pk=pk)
        if request.query_params.get('manage') != 'true':
            return Response({'results': [receipt_row(r) for r in query[:100]]})
        params = request.query_params
        if params.get('number'):
            number = serializers.IntegerField(min_value=1).run_validation(
                params['number'].lstrip('#')
            )
            query = query.filter(pk=number)
        if params.get('project'):
            query = query.filter(project__icontains=params['project'])
        if params.get('contract'):
            query = query.filter(contract__number__icontains=params['contract'])
        for key, lookup in [
            ('start', 'created_at__date__gte'),
            ('end', 'created_at__date__lte'),
        ]:
            if params.get(key):
                query = query.filter(
                    **{lookup: serializers.DateField().run_validation(params[key])}
                )
        details = WmsReceiptDetail.objects.filter(
            receipt_id=OuterRef('pk'), cancelled=False
        )
        received = Q(legacy=True) | Q(
            events__outcome='SUCCESS', events__operation='INBOUND'
        )
        query = query.annotate(
            has_pending=Exists(details.filter(events__outcome='PENDING')),
            has_received=Exists(details.filter(received)),
            has_unused=Exists(details.exclude(received)),
        ).annotate(
            management_state=Case(
                When(cancelled=True, then=Value('CANCELLED')),
                When(has_pending=True, then=Value('IN_REQUEST')),
                When(has_received=True, has_unused=True, then=Value('PARTIAL')),
                When(has_received=True, then=Value('RECEIVED')),
                default=Value('READY'),
                output_field=CharField(),
            )
        )
        if params.get('status'):
            query = query.filter(
                management_state=serializers.ChoiceField(
                    choices=['READY', 'IN_REQUEST', 'PARTIAL', 'RECEIVED', 'CANCELLED']
                ).run_validation(params['status'])
            )
        offset = serializers.IntegerField(min_value=0).run_validation(
            params.get('offset', 0)
        )
        limit = serializers.IntegerField(min_value=1, max_value=100).run_validation(
            params.get('limit', 25)
        )
        return Response(
            {
                'count': query.count(),
                'results': [
                    dict(receipt_row(r), status=r.management_state)
                    for r in query[offset : offset + limit]
                ],
            }
        )

    @extend_schema(
        request=ReceiptInput,
        responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT},
        description='Save or replay preparation by request_key. Saving does not create stock or scan events.',
    )
    @transaction.atomic
    def post(self, request):
        """Save once per client key, including retries after a lost response."""
        require(request, StockItem, 'change')
        serializer = ReceiptInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        details = values.pop('details')
        if not values['location'].check_ownership(request.user):
            raise PermissionDenied('没有此库位的业务权限')
        lock_parts([d['part'].pk for d in details])
        values['contract'] = WmsContract.objects.select_for_update().get(
            pk=values['contract'].pk
        )
        validate_contract_project(values['contract'], values['project_code'])
        existing = WmsReceipt.objects.filter(request_key=values['request_key']).first()
        fingerprint = clean_json(
            {
                **{
                    k: getattr(v, 'pk', v)
                    for k, v in values.items()
                    if k != 'project_code'
                },
                'details': [
                    {k: getattr(v, 'pk', v) for k, v in d.items()} for d in details
                ],
            }
        )
        if existing:
            if (
                existing.operator_id != request.user.pk
                or existing.input_snapshot != fingerprint
            ):
                raise ValidationError('保存标识已用于其他待入库内容')
            return Response(receipt_row(existing))
        receipt = WmsReceipt.objects.create(
            **values, operator=request.user, input_snapshot=fingerprint
        )
        for values in details:
            detail = WmsReceiptDetail.objects.create(
                receipt=receipt,
                project=receipt.project,
                project_code=receipt.project_code,
                contract=receipt.contract,
                **values,
            )
            warranty_end(
                detail.effective_acceptance_date, detail.effective_warranty_months
            )
        audit(
            request.user, 'receipt_create', receipt=receipt, after=receipt_row(receipt)
        )
        return Response(receipt_row(receipt), status=201)


class WmsReceiptCancel(ContractBusinessView):
    """Cancel an unused preparation, preserving its identifiers and audit."""

    @extend_schema(
        request=inline_serializer(
            'WmsReceiptCancelInput',
            fields={'reason': serializers.CharField(max_length=2000)},
        ),
        responses=OpenApiTypes.OBJECT,
    )
    @transaction.atomic
    def post(self, request, pk):
        """Require removal of active requests before cancellation."""
        require(request, StockItem, 'change')
        receipt = get_object_or_404(WmsReceipt.objects.select_for_update(), pk=pk)
        require_receipt_owner(receipt, request.user)
        reason = str(request.data.get('reason', '')).strip()
        if not reason:
            raise ValidationError('取消原因必填')
        lock_parts(receipt.details.values_list('part_id', flat=True))
        for detail in receipt.details.all():
            if (
                detail.legacy
                or detail.events.exclude(outcome='FAILED').exists()
                or detail.stock_items.exists()
            ):
                raise ValidationError('已有库存或有效申请的记录不能取消；请先处理申请')
        receipt.cancelled = True
        receipt.save(update_fields=['cancelled', 'updated_at'])
        audit(request.user, 'receipt_cancel', receipt=receipt, reason=reason)
        return Response(receipt_row(receipt))


class WmsDetailChange(ContractBusinessView):
    """Update current attribution and inventory while retaining all event snapshots."""

    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        description='Read current detail, complete barcode, effective warranty and inheritance flags.',
    )
    def get(self, request, pk):
        """Read a current detail for stock maintenance and replacement labels."""
        require(request, StockItem, 'view')
        return Response(detail_row(get_object_or_404(WmsReceiptDetail, pk=pk)))

    @extend_schema(
        request=DetailChangeInput,
        responses=OpenApiTypes.OBJECT,
        description='Update current detail. Attribution increments label_version and updates linked stock; historical event snapshots are preserved.',
    )
    @transaction.atomic
    def post(self, request, pk):
        """Replace label version only when project or contract attribution changes."""
        require(request, StockItem, 'change')
        seed = get_object_or_404(WmsReceiptDetail, pk=pk)
        serializer = DetailChangeInput(data=request.data, context={'detail': seed})
        serializer.is_valid(raise_exception=True)
        values = dict(serializer.validated_data)
        if not seed.legacy:
            require_receipt_owner(seed.receipt, request.user)
        lock_parts([seed.part_id])
        detail = WmsReceiptDetail.objects.select_for_update().get(pk=pk)
        current_contract = WmsContract.objects.select_for_update().get(
            pk=values.get('contract', detail.contract).pk
        )
        validate_contract_project(
            current_contract, values.get('project_code', detail.project_code)
        )
        if detail.receipt.cancelled or detail.cancelled:
            raise ValidationError('已取消记录不能修改')
        if values.pop('label_version') != detail.label_version:
            raise ValidationError('标签版本已变化，请刷新')
        reason = values.pop('reason')
        before = detail_row(detail)
        attribution = any(
            getattr(detail, field) != value
            for field, value in values.items()
            if field in ('project', 'contract')
        )
        quantity_changed = (
            'prepared_quantity' in values
            and values['prepared_quantity'] != detail.prepared_quantity
        )
        if attribution or quantity_changed:
            ensure_changeable(detail)
        if quantity_changed and (
            detail.legacy or detail.events.filter(outcome='SUCCESS').exists()
        ):
            raise ValidationError('已入库明细不能修改准备数量')
        for field, value in values.items():
            setattr(detail, field, value)
        warranty_end(detail.effective_acceptance_date, detail.effective_warranty_months)
        if attribution:
            detail.label_version += 1
        detail.save()
        detail.receipt.save(update_fields=['updated_at'])
        if attribution:
            StockItem.objects.filter(source_detail=detail).update(
                batch=detail.project, project_code=detail.project_code
            )
        audit(
            request.user,
            'detail_update',
            detail=detail,
            receipt=detail.receipt,
            before=before,
            after=detail_row(detail),
            reason=reason,
        )
        return Response(detail_row(detail))


class WmsReceiptChange(ContractBusinessView):
    """Edit shared preparation fields while all lines are still unused."""

    @extend_schema(
        operation_id='stock_wms_receipt_shared_update',
        request=inline_serializer(
            'WmsReceiptSharedInput',
            fields={
                'project': serializers.CharField(max_length=100),
                'project_id': serializers.IntegerField(min_value=1, required=False),
                'contract': serializers.IntegerField(min_value=1),
                'location': serializers.IntegerField(min_value=1),
                'reason': serializers.CharField(max_length=2000),
            },
        ),
        responses=OpenApiTypes.OBJECT,
    )
    @transaction.atomic
    def post(self, request, pk):
        """Update every prepared label together, requiring replacement on attribution changes."""
        require(request, StockItem, 'change')
        receipt = get_object_or_404(WmsReceipt.objects.select_for_update(), pk=pk)
        require_receipt_owner(receipt, request.user)
        if receipt.cancelled:
            raise ValidationError('已取消记录不能修改')
        if (
            request.data.get('expected_updated_at')
            and request.data['expected_updated_at'] != receipt.updated_at.isoformat()
        ):
            raise ValidationError('入库单已变化，请刷新后重试')
        project_values = bind_project(
            {
                **(
                    {
                        'project': serializers.CharField(max_length=100).run_validation(
                            request.data['project']
                        )
                    }
                    if 'project' in request.data
                    else {}
                ),
                **(
                    {
                        'project_id': serializers.IntegerField(
                            min_value=1
                        ).run_validation(request.data['project_id'])
                    }
                    if 'project_id' in request.data
                    else {}
                ),
            },
            allow_inactive=(
                request.data.get('project') == receipt.project
                or request.data.get('project_id') == receipt.project_code_id
            ),
        )
        project = project_values['project']
        contract = serializers.PrimaryKeyRelatedField(
            queryset=WmsContract.objects.all()
        ).run_validation(request.data.get('contract'))
        validate_contract_project(contract, project_values['project_code'])
        if contract.pk != receipt.contract_id and not contract.active:
            raise ValidationError('合同已停用，不能用于新归属')
        location = serializers.PrimaryKeyRelatedField(
            queryset=StockLocation.objects.filter(structural=False)
        ).run_validation(request.data.get('location'))
        reason = serializers.CharField(max_length=2000).run_validation(
            request.data.get('reason')
        )
        if not location.check_ownership(request.user):
            raise PermissionDenied('没有此库位的业务权限')
        lock_parts(receipt.details.values_list('part_id', flat=True))
        contract = WmsContract.objects.select_for_update().get(pk=contract.pk)
        validate_contract_project(contract, project_values['project_code'])
        details = list(
            receipt.details.filter(cancelled=False).select_for_update().order_by('pk')
        )
        before = receipt_row(receipt)
        for detail in details:
            ensure_changeable(detail)
            if (
                detail.legacy
                or detail.stock_items.exists()
                or detail.events.filter(outcome='SUCCESS').exists()
            ):
                raise ValidationError('已入库记录请逐条修改当前库存明细归属')
            if detail.project != project or detail.contract_id != contract.pk:
                detail.label_version += 1
            detail.project = project
            detail.project_code = project_values['project_code']
            detail.contract = contract
            warranty_end(
                detail.effective_acceptance_date, detail.effective_warranty_months
            )
            detail.save()
        receipt.project = project
        receipt.project_code = project_values['project_code']
        receipt.contract = contract
        receipt.location = location
        receipt.save()
        audit(
            request.user,
            'receipt_update',
            receipt=receipt,
            before=before,
            after=receipt_row(receipt),
            reason=reason,
        )
        return Response(receipt_row(receipt))


class ReceiptLineInput(DetailInput):
    """Existing line IDs retain identity; omitted IDs create new lines."""

    pk = serializers.IntegerField(min_value=1, required=False)

    class Meta(DetailInput.Meta):
        """Retain identity when editing an existing equipment line."""

        fields = ['pk', *DetailInput.Meta.fields]


class ReceiptLinesInput(serializers.Serializer):
    """Require an unchanged document revision before replacing unused lines."""

    details = ReceiptLineInput(many=True, allow_empty=False, max_length=100)
    expected_updated_at = serializers.CharField()
    reason = serializers.CharField(max_length=2000, allow_blank=False)


class WmsReceiptLines(ContractBusinessView):
    """Edit unused equipment lines, retaining removed identities and audit history."""

    @extend_schema(request=ReceiptLinesInput, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, pk):
        """Lock stock identities and reject all edits once any line is in use."""
        require(request, StockItem, 'change')
        receipt = get_object_or_404(WmsReceipt.objects.select_for_update(), pk=pk)
        require_receipt_owner(receipt, request.user)
        if receipt.cancelled:
            raise ValidationError('已作废入库单不能修改')
        serializer = ReceiptLinesInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        if receipt.updated_at.isoformat() != values['expected_updated_at']:
            raise ValidationError('入库单已变化，请刷新后重试')
        incoming = values['details']
        lock_parts(
            [
                *receipt.details.values_list('part_id', flat=True),
                *[d['part'].pk for d in incoming],
            ]
        )
        old = {
            d.pk: d for d in receipt.details.filter(cancelled=False).select_for_update()
        }
        ids = [d['pk'] for d in incoming if 'pk' in d]
        if len(ids) != len(set(ids)) or any(pk not in old for pk in ids):
            raise ValidationError('设备明细重复或不属于此入库单')
        for detail in old.values():
            ensure_changeable(detail)
            if (
                detail.legacy
                or detail.stock_items.exists()
                or detail.events.filter(outcome='SUCCESS').exists()
            ):
                raise ValidationError('已入库单据不能增删设备或修改准备数量')
        before = receipt_row(receipt)
        for row in incoming:
            line_id = row.get('pk')
            if line_id:
                detail = old[line_id]
                if detail.part_id != row['part'].pk:
                    detail.label_version += 1
                detail.part = row['part']
                detail.prepared_quantity = row['prepared_quantity']
                detail.save()
            else:
                WmsReceiptDetail.objects.create(
                    receipt=receipt,
                    project=receipt.project,
                    project_code=receipt.project_code,
                    contract=receipt.contract,
                    part=row['part'],
                    prepared_quantity=row['prepared_quantity'],
                )
        for line_id, detail in old.items():
            if line_id not in ids:
                detail.cancelled = True
                detail.label_version += 1
                detail.save(update_fields=['cancelled', 'label_version', 'updated_at'])
        receipt.save(update_fields=['updated_at'])
        audit(
            request.user,
            'receipt_lines_update',
            receipt=receipt,
            before=before,
            after=receipt_row(receipt),
            reason=values['reason'],
        )
        return Response(receipt_row(receipt))


class WmsLabelResolve(ContractBusinessView):
    """Resolve current complete labels and show exact actual-location balances."""

    required_alternate_scopes = WmsView.required_alternate_scopes

    @extend_schema(
        request=LabelResolveInput,
        responses=OpenApiTypes.OBJECT,
        description='Verify protocol and current database attribution. Returns authoritative detail and exact-location quantity, frozen, allocated and available balances.',
    )
    def post(self, request):
        """Never treat QR business fields as authoritative transaction inputs."""
        require(request, StockItem, 'view')
        serializer = LabelResolveInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        detail = resolve_label(values['barcode'])
        if values.get('receipt') and str(detail.receipt_id) != str(values['receipt']):
            raise ValidationError('标签属于其他待入库记录')
        row = detail_row(detail)
        query = StockItem.objects.filter(
            current_stock_filter(), source_detail=detail
        ).select_related('location')
        if values.get('location'):
            query = query.filter(location_id=values['location'])
        row['stock'] = [
            {
                'pk': item.pk,
                'location': item.location_id,
                'location_name': item.location.pathstring if item.location else '',
                'quantity': item.quantity,
                'frozen': item.scan_frozen_quantity(),
                'allocated': item.allocation_count(),
                'available': item.unallocated_quantity(),
            }
            for item in query
        ]
        return Response(row)


class WmsLegacyAttribute(ContractBusinessView):
    """Associate verified historical quantities without fabricating an inbound event."""

    @extend_schema(
        request=inline_serializer(
            'WmsLegacyAttributionInput',
            fields={
                'request_key': serializers.UUIDField(),
                'project': serializers.CharField(max_length=100, required=False),
                'contract': serializers.IntegerField(min_value=1),
                'quantity': serializers.DecimalField(
                    max_digits=15, decimal_places=5, min_value=Decimal('0.00001')
                ),
                'confirmed_stock_quantity': serializers.DecimalField(
                    max_digits=15, decimal_places=5, min_value=0
                ),
                'confirmed_single_contract': serializers.BooleanField(),
                'reason': serializers.CharField(max_length=2000),
            },
        ),
        responses={200: OpenApiTypes.OBJECT, 201: OpenApiTypes.OBJECT},
        description='Link an explicitly verified historical quantity, splitting if necessary. Never creates an inbound event. request_key replays an identical saved backfill.',
    )
    @transaction.atomic
    def post(self, request, pk):
        """Split only an explicitly confirmed portion when several contracts share a row."""
        require(request, StockItem, 'change')
        seed = get_object_or_404(StockItem, pk=pk)
        lock_parts([seed.part_id])
        request_key = serializers.UUIDField().run_validation(
            request.data.get('request_key')
        )
        snapshot = {'legacy_stock': pk, 'payload': clean_json(request.data)}
        existing = WmsReceipt.objects.filter(request_key=request_key).first()
        if existing:
            if (
                existing.operator_id != request.user.pk
                or existing.input_snapshot != snapshot
            ):
                raise ValidationError('补录保存标识已用于其他内容')
            return Response(detail_row(existing.details.get()))
        item = StockItem.objects.select_for_update().get(pk=pk)
        if item.location and not item.location.check_ownership(request.user):
            raise PermissionDenied('没有此库位的业务权限')
        if item.source_detail_id:
            raise ValidationError('该行已补录，请刷新后修改当前明细')
        if (
            item.scan_frozen_quantity()
            or item.allocation_count()
            or not item.in_stock
            or item.serialized
        ):
            raise ValidationError('库存存在占用或状态不支持补录')
        contract_pk = serializers.IntegerField(min_value=1).run_validation(
            request.data.get('contract')
        )
        contract = get_object_or_404(WmsContract, pk=contract_pk)
        payload = {
            'request_key': request.data.get('request_key'),
            'project': request.data.get('project', item.batch),
            'contract': contract.pk,
            'location': item.location_id,
            'details': [
                {
                    'part': item.part_id,
                    'prepared_quantity': request.data.get('quantity'),
                }
            ],
        }
        if 'project_id' in request.data:
            payload['project_id'] = request.data['project_id']
            if 'project' not in request.data:
                payload.pop('project')
        serializer = ReceiptInput(data=payload)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        quantity = values['details'][0]['prepared_quantity']
        confirmed = serializers.DecimalField(
            max_digits=15, decimal_places=5, min_value=0
        ).run_validation(request.data.get('confirmed_stock_quantity'))
        if (
            confirmed != item.quantity
            or quantity > item.quantity
            or request.data.get('confirmed_single_contract') is not True
        ):
            raise ValidationError('请明确核对归属数量；混合合同必须分别拆分补录')
        reason = str(request.data.get('reason', '')).strip()
        if not reason:
            raise ValidationError('补录原因必填')
        if WmsReceipt.objects.filter(request_key=values['request_key']).exists():
            raise ValidationError('补录保存标识已使用，请刷新库存')
        receipt = WmsReceipt.objects.create(
            request_key=values['request_key'],
            project=values['project'],
            project_code=values['project_code'],
            contract=contract,
            location=item.location,
            operator=request.user,
            input_snapshot=snapshot,
        )
        detail = WmsReceiptDetail.objects.create(
            receipt=receipt,
            project=receipt.project,
            project_code=receipt.project_code,
            contract=contract,
            part=item.part,
            prepared_quantity=quantity,
            legacy=True,
        )
        before = {
            'stock': item.pk,
            'quantity': str(item.quantity),
            'project': item.batch,
        }
        if quantity < item.quantity:
            item = item.splitStock(quantity, user=request.user, notes=reason)
        StockItem.objects.filter(pk=item.pk).update(
            source_detail=detail, batch=detail.project, project_code=detail.project_code
        )
        audit(
            request.user,
            'legacy_attribute',
            detail=detail,
            before=before,
            after={'stock': item.pk, **detail_row(detail)},
            reason=reason,
        )
        return Response(detail_row(detail), status=201)


class WmsChangeHistory(ContractBusinessView):
    """Provide operator, timestamp, reason and before/after values for maintenance."""

    @extend_schema(
        responses=OpenApiTypes.OBJECT,
        description='Return results with actor, timestamp, reason and before/after values; filter by contract, receipt or detail.',
    )
    def get(self, request):
        """Read a bounded history filtered to a contract, preparation or detail."""
        require(request, StockItem, 'view')
        query = WmsBusinessChange.objects.select_related('actor').order_by('-pk')
        filters = {
            f'{field}_id': serializers.IntegerField(min_value=1).run_validation(
                request.query_params[field]
            )
            for field in ('contract', 'receipt', 'detail')
            if request.query_params.get(field)
        }
        if not filters:
            raise ValidationError('请选择合同、待入库记录或明细')
        if filters.get('receipt_id'):
            require_receipt_owner(
                get_object_or_404(WmsReceipt, pk=filters['receipt_id']), request.user
            )
        return Response(
            {
                'results': [
                    {
                        'pk': row.pk,
                        'action': row.action,
                        'actor': row.actor.username if row.actor else '',
                        'created_at': row.created_at,
                        'reason': row.reason,
                        'before': row.before,
                        'after': row.after,
                    }
                    for row in query.filter(**filters)[:100]
                ]
            }
        )


class WmsScanCandidates(ContractBusinessView):
    """Find existing prepared sources for the same label-based scanning workflow."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        """Search by catalogue name/model without creating or changing any stock."""
        require(request, StockItem, 'view')
        search = str(request.query_params.get('search', '')).strip()
        operation = request.query_params.get('operation', 'INBOUND')
        if operation not in ('INBOUND', 'OUTBOUND'):
            raise ValidationError('请选择入库或出库')
        query = (
            WmsReceiptDetail.objects.filter(cancelled=False, receipt__cancelled=False)
            .filter(
                Q(part__name__icontains=search)
                | Q(part__IPN__icontains=search)
                | Q(part__model_number__icontains=search)
            )
            .select_related('part', 'contract', 'receipt', 'project_code')
        )
        location = request.query_params.get('location')
        if location:
            location = serializers.IntegerField(min_value=1).run_validation(location)
        if operation == 'INBOUND':
            query = query.filter(legacy=False)
            if not request.user.is_superuser:
                query = query.filter(receipt__operator=request.user)
            if location:
                query = query.filter(receipt__location_id=location)
        rows = []
        for detail in query.order_by('-pk')[:100]:
            stock = StockItem.objects.filter(
                current_stock_filter(), source_detail=detail
            ).select_related('location')
            if location:
                stock = stock.filter(location_id=location)
            balances = [
                {
                    'pk': item.pk,
                    'location': item.location_id,
                    'location_name': item.location.pathstring if item.location else '',
                    'quantity': item.quantity,
                    'frozen': item.scan_frozen_quantity(),
                    'allocated': item.allocation_count(),
                    'available': item.unallocated_quantity(),
                }
                for item in stock
            ]
            if operation == 'OUTBOUND' and not any(
                item['available'] > 0 for item in balances
            ):
                continue
            rows.append(
                {
                    **detail_row(detail),
                    'receipt_location_name': detail.receipt.location.pathstring,
                    'stock': balances,
                }
            )
        return Response(
            {'results': rows, 'limit': 100, 'has_more': query.count() > 100}
        )
