"""Authenticated, append-only arrival and outbound business evidence."""

import io
from pathlib import PurePath

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from stock.contract_api import ContractBusinessView
from stock.models import ScanStockApprovalRequest, StockItem, WmsBusinessAttachment
from stock.services import ApprovalRequestService
from stock.wms import require
from users.models import Owner
from users.oauth2_scopes import DEFAULT_READ, get_granular_scope
from users.permissions import check_user_permission


class DocumentInput(serializers.Serializer):
    """Bounded optional evidence, independent of inventory posting."""

    file = serializers.FileField()
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True)


def require_document_read(request):
    """Preserve approval-only readers without granting unrelated stock access."""
    if not check_user_permission(request.user, StockItem, 'view') and (
        request.user.has_perm(ApprovalRequestService.APPROVE_PERMISSION)
        or request.user.has_perm(ApprovalRequestService.AUDIT_PERMISSION)
    ):
        return
    require(request, StockItem, 'view')


def visible_request(user, pk):
    """Match the approval detail's object-level visibility, including after posting."""
    query = ScanStockApprovalRequest.objects.all()
    if not user.has_perm(ApprovalRequestService.AUDIT_PERMISSION):
        from django.db.models import Q

        owners = (
            Owner.get_owners_matching_user(user)
            if user.has_perm(ApprovalRequestService.APPROVE_PERMISSION)
            else []
        )
        query = query.filter(Q(requester=user) | Q(approval_owner__in=owners))
    return get_object_or_404(query, pk=pk)


def can_upload(user, approval):
    """Only the requester or an auditor with stock-change rights may append evidence."""
    return check_user_permission(user, StockItem, 'change') and (
        approval.requester_id == user.pk
        or user.has_perm(ApprovalRequestService.AUDIT_PERMISSION)
    )


def document_row(document):
    """Expose metadata and a protected download route, never public media paths."""
    return {
        'pk': document.pk,
        'name': document.name,
        'size': document.size,
        'uploaded_at': document.uploaded_at.isoformat(),
        'uploaded_by': document.uploader_name,
        'note': document.note,
        'download_url': reverse(
            'api-stock-business-document-download',
            kwargs={'pk': document.request_id, 'attachment_pk': document.pk},
        ),
    }


class PrivateDocumentsView(ContractBusinessView):
    """Keep both evidence metadata and content out of intermediary caches."""

    required_alternate_scopes = {
        **ContractBusinessView.required_alternate_scopes,
        **{
            method: [[DEFAULT_READ], [get_granular_scope('view', 'stock')]]
            for method in ('GET', 'HEAD', 'OPTIONS')
        },
    }

    def finalize_response(self, request, response, *args, **kwargs):
        """Apply private cache policy to successful and denied responses alike."""
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'private, no-store'
        return response


class WmsBusinessDocuments(PrivateDocumentsView):
    """List and append supporting documents without changing approval or stock."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        """Include post-completion uploads and the caller's actual write capability."""
        require_document_read(request)
        approval = visible_request(request.user, pk)
        return Response(
            {
                'results': [
                    document_row(item)
                    for item in approval.business_attachments.defer('content')
                ],
                'can_upload': can_upload(request.user, approval),
            }
        )

    @extend_schema(request=DocumentInput, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, pk):
        """Append PDF or image evidence; completed requests remain writable here."""
        from rest_framework.exceptions import PermissionDenied

        require(request, StockItem, 'change')
        approval = visible_request(request.user, pk)
        if not can_upload(request.user, approval):
            raise PermissionDenied('只能由申请人或有权限的管理人员补充单据附件')
        serializer = DocumentInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data['file']
        if upload.size <= 0 or upload.size > 10 * 1024 * 1024:
            raise ValidationError('附件大小必须在 0 至 10 MB 之间')
        name = PurePath(upload.name.replace('\\', '/')).name
        if len(name) > 200 or any(ord(c) < 32 for c in name):
            raise ValidationError('附件文件名无效或过长')
        payload = upload.read(10 * 1024 * 1024 + 1)
        if len(payload) > 10 * 1024 * 1024:
            raise ValidationError('附件不能超过 10 MB')
        suffix = PurePath(name).suffix.lower()
        formats = {
            '.pdf': ('application/pdf', payload.startswith(b'%PDF-')),
            '.png': ('image/png', payload.startswith(b'\x89PNG\r\n\x1a\n')),
            '.jpg': ('image/jpeg', payload.startswith(b'\xff\xd8\xff')),
            '.jpeg': ('image/jpeg', payload.startswith(b'\xff\xd8\xff')),
        }
        kind, valid = formats.get(suffix, ('', False))
        if not valid:
            raise ValidationError('仅支持内容与扩展名一致的 PDF、PNG、JPG 文件')
        document = WmsBusinessAttachment.objects.create(
            request=approval,
            name=name,
            content=payload,
            size=len(payload),
            content_type=kind,
            note=serializer.validated_data.get('note', ''),
            uploaded_by=request.user,
            uploader_name=(request.user.get_full_name() or request.user.username)[:200],
        )
        return Response(document_row(document), status=201)


class WmsBusinessDocumentDownload(PrivateDocumentsView):
    """Never expose evidence through anonymous media-serving routes."""

    @extend_schema(responses=OpenApiTypes.BINARY)
    def get(self, request, pk, attachment_pk):
        """Recheck request visibility on each download, including guessed IDs."""
        require_document_read(request)
        approval = visible_request(request.user, pk)
        document = get_object_or_404(
            WmsBusinessAttachment, pk=attachment_pk, request=approval
        )
        response = FileResponse(
            io.BytesIO(bytes(document.content)),
            as_attachment=True,
            filename=document.name,
            content_type=document.content_type,
        )
        response['X-Content-Type-Options'] = 'nosniff'
        response['Cache-Control'] = 'private, no-store'
        return response
