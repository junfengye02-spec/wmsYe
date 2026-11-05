"""Warehouse maintenance must preserve barcode identity and stock audit boundaries."""

import uuid

from django.contrib.auth.models import Permission, User
from django.core.exceptions import ValidationError
from django.test import TestCase

from common.models import ProjectCode
from part.models import Part
from stock import test_contract_warranty as fixtures
from stock.models import StockItem, WmsBusinessChange, WmsContract, WmsReceiptDetail
from stock.warranty import encode_label, resolve_label


class WarehouseMaintenanceTest(TestCase):
    """Exercise public APIs with real receipt and approval state transitions."""

    setUp = fixtures.ContractWarrantyTest.setUp
    post = fixtures.ContractWarrantyTest.post
    prepare = fixtures.ContractWarrantyTest.prepare
    request = fixtures.ContractWarrantyTest.request
    scan = fixtures.ContractWarrantyTest.scan
    receive = fixtures.ContractWarrantyTest.receive

    def lines(self, receipt, rows, expected=200, **extra):
        """Update using the current receipt revision."""
        receipt.refresh_from_db()
        return self.post(
            f'wms/receipts/{receipt.pk}/lines/',
            {
                'details': rows,
                'reason': 'maintenance test',
                'expected_updated_at': receipt.updated_at.isoformat(),
                **extra,
            },
            expected,
        )

    def test_project_update_deactivate_and_delete_references(self):
        """Referenced project identity survives CRUD; inactive projects cannot start receipts."""
        unused = self.post('wms/projects/', {'code': 'unused'}, 201)
        self.post(
            'wms/projects/',
            {'pk': unused['pk'], 'code': 'renamed', 'description': 'edited'},
        )
        self.post('wms/projects/', {'pk': unused['pk'], 'action': 'delete'})
        self.assertFalse(ProjectCode.objects.filter(pk=unused['pk']).exists())
        detail = self.prepare()
        pk = detail.project_code_id
        self.post('wms/projects/', {'pk': pk, 'code': 'wrong'}, 400)
        self.post('wms/projects/', {'pk': pk, 'action': 'delete'}, 400)
        self.post(
            'wms/projects/', {'pk': pk, 'active': False, 'description': 'inactive'}
        )
        self.assertEqual(resolve_label(encode_label(detail)).pk, detail.pk)
        data = {
            'request_key': str(uuid.uuid4()),
            'project': detail.project,
            'contract': self.contract.pk,
            'location': self.location.pk,
            'details': [{'part': self.part.pk, 'prepared_quantity': 1}],
        }
        self.post('wms/receipts/', data, 400)
        all_rows = self.client.get('/api/stock/wms/projects/?all=true').data['results']
        self.assertTrue(any(r['pk'] == pk and not r['active'] for r in all_rows))

    def test_contract_delete_keeps_audit_and_deactivation_keeps_labels(self):
        """Unused contracts can be removed, but used ones can only be deactivated."""
        unused = self.post(
            'wms/contracts/',
            {
                'number': 'unused',
                'warranty_months': 12,
                'project_id': ProjectCode.objects.get(code='新项目').pk,
            },
            201,
        )
        self.post('wms/contracts/', {'pk': unused['pk'], 'action': 'delete'})
        self.assertFalse(WmsContract.objects.filter(pk=unused['pk']).exists())
        self.assertTrue(
            WmsBusinessChange.objects.filter(
                action='contract_delete', before__pk=unused['pk']
            ).exists()
        )
        detail = self.prepare()
        code = encode_label(detail)
        self.post('wms/contracts/', {'pk': self.contract.pk, 'action': 'delete'}, 400)
        self.post(
            'wms/contracts/',
            {
                'pk': self.contract.pk,
                'active': False,
                'reason': 'inactive',
                'expected_updated_at': self.contract.updated_at.isoformat(),
            },
        )
        self.assertEqual(resolve_label(code).pk, detail.pk)
        self.post(
            'wms/receipts/',
            {
                'request_key': str(uuid.uuid4()),
                'project': detail.project,
                'contract': self.contract.pk,
                'location': self.location.pk,
                'details': [{'part': self.part.pk, 'prepared_quantity': 1}],
            },
            400,
        )

    def test_remove_add_and_quantity_edit_invalidate_only_removed_label(self):
        """Line edits never create stock and removed QR codes can never be reused."""
        detail = self.prepare()
        code = encode_label(detail)
        extra = Part.objects.create(name='second', IPN='SECOND', units='count')
        row = self.lines(
            detail.receipt,
            [
                {'pk': detail.pk, 'part': self.part.pk, 'prepared_quantity': 3},
                {'part': extra.pk, 'prepared_quantity': 2},
            ],
        )
        self.assertEqual(len(row['details']), 2)
        self.assertEqual(resolve_label(code).prepared_quantity, 3)
        second = row['details'][1]
        self.lines(
            detail.receipt,
            [{'pk': second['pk'], 'part': extra.pk, 'prepared_quantity': 2}],
        )
        with self.assertRaises(ValidationError):
            resolve_label(code)
        self.assertTrue(WmsReceiptDetail.objects.get(pk=detail.pk).cancelled)
        self.assertFalse(StockItem.objects.exists())
        self.assertEqual(
            WmsBusinessChange.objects.filter(action='receipt_lines_update').count(), 2
        )

    def test_line_update_rejects_stale_foreign_pending_and_received(self):
        """Stale forms and in-use lines cannot mutate receipt identities."""
        detail = self.prepare()
        rows = [{'pk': detail.pk, 'part': self.part.pk, 'prepared_quantity': 2}]
        self.lines(detail.receipt, rows, 400, expected_updated_at='stale')
        self.lines(detail.receipt, [{**rows[0], 'pk': 99999}], 400)
        pending = self.request()
        self.assertEqual(self.scan(detail, pending).status_code, 201)
        self.lines(detail.receipt, rows, 400)
        other = self.prepare()
        self.receive(other)
        self.lines(
            other.receipt,
            [{'pk': other.pk, 'part': self.part.pk, 'prepared_quantity': 2}],
            400,
        )

    def test_receipt_list_filters_and_owner_boundary(self):
        """The management list and mutation endpoints enforce the same owner scope."""
        detail = self.prepare()
        data = self.client.get(
            '/api/stock/wms/receipts/',
            {
                'manage': 'true',
                'number': str(detail.receipt_id),
                'status': 'READY',
                'project': detail.project,
            },
        ).data
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['status'], 'READY')
        operator = User.objects.create_user('other-operator')
        operator.user_permissions.set(
            Permission.objects.filter(
                content_type__app_label='stock',
                codename__in=['view_stockitem', 'change_stockitem'],
            )
        )
        self.client.force_authenticate(operator)
        self.assertEqual(
            self.client.get('/api/stock/wms/receipts/?manage=true').data['count'], 0
        )
        self.lines(
            detail.receipt,
            [{'pk': detail.pk, 'part': self.part.pk, 'prepared_quantity': 2}],
            403,
        )
        self.post(
            f'wms/receipts/{detail.receipt_id}/cancel/', {'reason': 'wrong owner'}, 403
        )

    def test_acceptance_and_warranty_changes_preserve_original_code_and_empty_purpose(
        self,
    ):
        """Acceptance is optional at inbound; later updates preserve the same outbound label."""
        self.contract.acceptance_date = None
        self.contract.save()
        detail = self.prepare()
        code = encode_label(detail)
        self.receive(detail)
        self.post(
            'wms/contracts/',
            {
                'pk': self.contract.pk,
                'acceptance_date': '2026-11-02',
                'warranty_months': 24,
                'reason': 'acceptance',
                'expected_updated_at': self.contract.updated_at.isoformat(),
            },
        )
        detail.refresh_from_db()
        self.assertEqual(encode_label(detail), code)
        resolved = self.post('wms/labels/resolve/', {'barcode': code})
        self.assertEqual(resolved['warranty_end'], '2028-11-02')
        request = self.request('OUTBOUND')
        response = self.scan(detail, request, 1, purpose='')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(request.lines.get().purpose, '')

    def test_same_label_can_receive_again_and_retries_never_double_count(self):
        """Intentional rescans append events and approvals accumulate one stock balance."""
        from stock.services import ApprovalRequestService

        detail = self.prepare()
        request = self.request()
        first = self.scan(detail, request)
        second = self.scan(detail, request)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(request.lines.filter(outcome='PENDING').count(), 2)
        retry = self.scan(
            detail, request, client_event_id=second.data['event']['client_event_id']
        )
        self.assertTrue(retry.data['replayed'])
        ApprovalRequestService.submit(request_id=request.pk, user=self.user)
        ApprovalRequestService.approve(request_id=request.pk, user=self.approver)
        self.assertEqual(StockItem.objects.get(source_detail=detail).quantity, 20)
        again = self.request()
        self.assertEqual(self.scan(detail, again).status_code, 201)
        ApprovalRequestService.submit(request_id=again.pk, user=self.user)
        ApprovalRequestService.approve(request_id=again.pk, user=self.approver)
        self.assertEqual(StockItem.objects.get(source_detail=detail).quantity, 30)
        resolved = self.post('wms/labels/resolve/', {'barcode': encode_label(detail)})
        self.assertEqual(resolved['received_quantity'], 30)
        self.assertEqual(resolved['pending_quantity'], 0)
        self.assertEqual(resolve_label(encode_label(detail)).pk, detail.pk)
