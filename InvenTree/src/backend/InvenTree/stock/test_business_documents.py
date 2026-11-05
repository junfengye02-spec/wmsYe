"""Regression coverage for optional evidence, project binding and manual scans."""

import uuid

from django.contrib.auth.models import Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from common.models import ProjectCode
from stock import test_contract_warranty as fixtures
from stock.models import WmsBusinessAttachment, WmsContract


class BusinessDocumentsTest(TestCase):
    """Drive new features through APIs and verify unchanged stock balances."""

    setUp = fixtures.ContractWarrantyTest.setUp
    post = fixtures.ContractWarrantyTest.post
    prepare = fixtures.ContractWarrantyTest.prepare
    request = fixtures.ContractWarrantyTest.request
    scan = fixtures.ContractWarrantyTest.scan
    receive = fixtures.ContractWarrantyTest.receive

    def upload(self, approval, content=b'%PDF-1.4\nreceipt', name='receipt.pdf'):
        """Post real multipart evidence to its request."""
        return self.client.post(
            f'/api/stock/scan/requests/{approval.pk}/attachments/',
            {'file': SimpleUploadedFile(name, content), 'note': '补充到货凭证'},
            format='multipart',
        )

    def test_posted_evidence_is_optional_append_only_and_private(self):
        """Completion needs no file and subsequent evidence cannot alter inventory."""
        detail = self.prepare()
        item, approval = self.receive(detail)
        before = item.quantity
        response = self.upload(approval)
        self.assertEqual(response.status_code, 201, response.data)
        row = response.data
        self.assertNotIn('content', row)
        self.assertIn('uploaded_by', row)
        item.refresh_from_db()
        self.assertEqual(item.quantity, before)
        approval.refresh_from_db()
        self.assertEqual(approval.status, 'COMPLETED')
        download = self.client.get(row['download_url'])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(b''.join(download.streaming_content), b'%PDF-1.4\nreceipt')
        self.assertIn('attachment;', download['Content-Disposition'])
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(row['download_url']).status_code, (401, 403))
        self.assertEqual(WmsBusinessAttachment.objects.count(), 1)

    def test_unrelated_operator_cannot_read_or_upload_guessed_request(self):
        """Stock view/change alone do not grant access to another request's files."""
        approval = self.request()
        response = self.upload(approval)
        self.assertEqual(response.status_code, 201, response.data)
        other = User.objects.create_user('unrelated-evidence')
        other.user_permissions.add(
            *Permission.objects.filter(
                codename__in=['view_stockitem', 'change_stockitem']
            )
        )
        self.client.force_authenticate(other)
        self.assertEqual(
            self.client.get(response.data['download_url']).status_code, 404
        )
        self.assertEqual(self.upload(approval).status_code, 404)

    def test_invalid_files_rejected_and_draft_upload_supported(self):
        """File validation rejects active formats and mismatched extension bytes."""
        approval = self.request()
        self.assertEqual(
            self.upload(approval, b'<script>x</script>', 'bad.pdf').status_code, 400
        )
        self.assertEqual(
            self.upload(approval, b'%PDF-1.4', 'bad.html').status_code, 400
        )
        self.assertEqual(self.upload(approval).status_code, 201)
        listing = self.client.get(
            f'/api/stock/scan/requests/{approval.pk}/attachments/'
        )
        self.assertTrue(listing.data['can_upload'])
        self.assertEqual(len(listing.data['results']), 1)

    def test_contract_project_filters_and_rejects_mismatched_preparation(self):
        """Explicit contract ownership gates both selection and creation."""
        self.post('wms/contracts/', {'number': 'unassigned'}, 400)
        project = ProjectCode.objects.get(code='新项目')
        created = self.post(
            'wms/contracts/', {'number': 'owned', 'project_id': project.pk}, 201
        )
        self.assertEqual(created['project_id'], project.pk)
        owned = WmsContract.objects.get(pk=created['pk'])
        self.post(
            'wms/receipts/',
            {
                'request_key': str(uuid.uuid4()),
                'project': '其他',
                'contract': owned.pk,
                'location': self.location.pk,
                'details': [{'part': self.part.pk, 'prepared_quantity': 1}],
            },
            400,
        )
        other = ProjectCode.objects.get(code='其他')
        rows = self.client.get(
            '/api/stock/wms/contracts/', {'project_id': other.pk}
        ).data['results']
        self.assertNotIn(owned.pk, [r['pk'] for r in rows])

    def test_used_contract_cannot_be_reparented(self):
        """New project metadata must not silently contradict historical receipts."""
        detail = self.prepare()
        self.post(
            'wms/contracts/',
            {
                'pk': self.contract.pk,
                'project_id': ProjectCode.objects.get(code='其他').pk,
                'reason': 'wrong move',
                'expected_updated_at': self.contract.updated_at.isoformat(),
            },
            400,
        )
        detail.refresh_from_db()
        self.assertNotEqual(
            detail.project_code_id, ProjectCode.objects.get(code='其他').pk
        )

    def test_manual_candidates_preserve_source_identity(self):
        """Model search returns original full labels and never creates stock."""
        detail = self.prepare()
        self.part.model_number = 'SEARCH-MODEL'
        self.part.save()
        response = self.client.get(
            '/api/stock/wms/scan-candidates/', {'search': 'SEARCH-MODEL'}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['results'][0]['pk'], detail.pk)
        self.assertEqual(response.data['results'][0]['receipt'], detail.receipt_id)
        self.assertFalse(detail.stock_items.exists())

    def test_blank_manual_candidates_list_available_details(self):
        """Empty search lists prepared inbound sources and available outbound stock."""
        detail = self.prepare()
        url = '/api/stock/wms/scan-candidates/'
        for search in ('', '   '):
            response = self.client.get(url, {'search': search, 'operation': 'INBOUND'})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(
                [row['pk'] for row in response.data['results']], [detail.pk]
            )
        self.assertEqual(
            self.client.get(url, {'operation': 'OUTBOUND'}).data['results'], []
        )
        item, _ = self.receive(detail)
        response = self.client.get(
            url, {'operation': 'OUTBOUND', 'location': self.location.pk}
        )
        self.assertEqual([row['pk'] for row in response.data['results']], [detail.pk])
        self.assertEqual(
            self.client.get(
                url, {'operation': 'INBOUND', 'search': 'not-matching'}
            ).data['results'],
            [],
        )
        item.quantity = 0
        item.save()
        self.assertEqual(
            self.client.get(url, {'operation': 'OUTBOUND'}).data['results'], []
        )

    def test_assigned_approver_can_read_without_stock_view(self):
        """An approval-only user retains evidence visibility but cannot append."""
        approval = self.request()
        uploaded = self.upload(approval)
        self.approver.is_superuser = False
        self.approver.is_staff = False
        self.approver.save()
        self.approver.user_permissions.add(
            Permission.objects.get(codename='approve_scanstockapprovalrequest')
        )
        self.client.force_authenticate(self.approver)
        response = self.client.get(
            f'/api/stock/scan/requests/{approval.pk}/attachments/'
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['can_upload'])
        self.assertEqual(
            self.client.get(uploaded.data['download_url']).status_code, 200
        )
        self.assertEqual(self.upload(approval).status_code, 403)

    def test_records_expose_source_and_evidence_capabilities(self):
        """Statistics expose attachment actions only for visible approval requests."""
        detail = self.prepare()
        self.part.brand = '华三'
        self.part.model_number = 'S5130'
        self.part.save()
        _, approval = self.receive(detail)
        self.upload(approval)
        response = self.client.get('/api/stock/wms/records/')
        row = response.data['results'][0]
        self.assertEqual(row['approval_request'], approval.pk)
        self.assertEqual(row['attachment_count'], 1)
        self.assertEqual(row['model_number'], 'S5130')
        self.assertTrue(row['can_view_attachments'])
        other = User.objects.create_user('records-reader')
        other.user_permissions.add(Permission.objects.get(codename='view_stockitem'))
        self.client.force_authenticate(other)
        response = self.client.get('/api/stock/wms/records/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data['results'][0]['can_view_attachments'])

    def test_project_backfill_preserves_ambiguous_history(self):
        """Only a single known project may be inferred from old source documents."""
        import importlib
        from types import SimpleNamespace

        from django.apps import apps
        from django.db import connection

        from stock.models import WmsReceipt

        detail = self.prepare()
        unambiguous = self.contract
        ambiguous = WmsContract.objects.create(number='mixed history')
        WmsReceipt.objects.create(
            project=detail.project,
            project_code=detail.project_code,
            contract=ambiguous,
            location=self.location,
            operator=self.user,
        )
        other = ProjectCode.objects.get(code='其他')
        WmsReceipt.objects.create(
            project=other.code,
            project_code=other,
            contract=ambiguous,
            location=self.location,
            operator=self.user,
        )
        unknown = WmsContract.objects.create(number='unknown history')
        WmsReceipt.objects.create(
            project='old unknown',
            contract=unknown,
            location=self.location,
            operator=self.user,
        )
        migration = importlib.import_module(
            'stock.migrations.0139_wms_business_documents'
        )
        migration.bind_contract_projects(apps, SimpleNamespace(connection=connection))
        unambiguous.refresh_from_db()
        ambiguous.refresh_from_db()
        unknown.refresh_from_db()
        self.assertEqual(unambiguous.project_id, detail.project_code_id)
        self.assertIsNone(ambiguous.project_id)
        self.assertIsNone(unknown.project_id)

    def test_outbound_evidence_can_be_added_after_completion(self):
        """Outbound proof is optional and later uploads never release or deduct stock."""
        from stock.services import ApprovalRequestService

        detail = self.prepare()
        item, _ = self.receive(detail)
        approval = self.request('OUTBOUND')
        response = self.scan(detail, approval, quantity=3, purpose='')
        self.assertEqual(response.status_code, 201, response.data)
        ApprovalRequestService.submit(request_id=approval.pk, user=self.user)
        ApprovalRequestService.approve(request_id=approval.pk, user=self.approver)
        item.refresh_from_db()
        self.assertEqual(item.quantity, 7)
        self.assertEqual(self.upload(approval).status_code, 201)
        item.refresh_from_db()
        self.assertEqual(item.quantity, 7)
        self.assertEqual(item.scan_frozen_quantity(), 0)

    def test_approval_only_attachment_reader_still_requires_stock_oauth_scope(self):
        """An approval grant must not let a catalogue-only token read stock evidence."""
        from datetime import timedelta

        from django.utils import timezone

        from oauth2_provider.models import AccessToken, Application
        from rest_framework.test import APIClient

        from users.oauth2_scopes import DEFAULT_READ, get_granular_scope

        approval = self.request()
        self.upload(approval)
        self.approver.is_superuser = False
        self.approver.is_staff = False
        self.approver.save()
        self.approver.user_permissions.add(
            Permission.objects.get(codename='approve_scanstockapprovalrequest')
        )
        application = Application.objects.create(
            user=self.approver,
            client_type=Application.CLIENT_CONFIDENTIAL,
            authorization_grant_type=Application.GRANT_PASSWORD,
        )
        client = APIClient()
        for scope, expected in (
            (get_granular_scope('view', 'part'), 403),
            (DEFAULT_READ, 200),
        ):
            token = str(uuid.uuid4())
            AccessToken.objects.create(
                user=self.approver,
                application=application,
                token=token,
                expires=timezone.now() + timedelta(hours=1),
                scope=scope,
            )
            client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            response = client.get(
                f'/api/stock/scan/requests/{approval.pk}/attachments/'
            )
            self.assertEqual(response.status_code, expected, response.data)
