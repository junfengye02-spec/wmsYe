"""Warehouse history access and immutable business-field regression tests."""

from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.utils import timezone

from oauth2_provider.models import AccessToken, Application
from rest_framework.test import APIClient

from common.settings import set_global_setting
from InvenTree.unit_test import InvenTreeAPITestCase, addUserPermission
from part.models import Part, PartStocktake
from stock.models import StockItem, StockItemTracking
from stock.serializers import StockTrackingSerializer
from users.oauth2_scopes import get_granular_scope


class StockHistoryAccessTest(InvenTreeAPITestCase):
    """A normal stock role must not expose native history to an operator."""

    roles = ['stock.view', 'stock.add', 'stock.change', 'part.view', 'part.add']

    def setUp(self):
        """Create real rows so detail and export checks cannot pass via a 404."""
        super().setUp()
        self.user.is_staff = False
        self.user.is_superuser = False
        self.user.save()
        self.part = Part.objects.create(name='History device')
        self.item = StockItem.objects.create(part=self.part, quantity=10)
        self.tracking = StockItemTracking.objects.create(
            item=self.item, part=self.part, tracking_type=10, deltas={'quantity': 10}
        )
        self.snapshot = PartStocktake.objects.create(part=self.part, quantity=10)

    def urls(self):
        """Cover list, direct links and export metadata."""
        return [
            '/api/stock/track/',
            f'/api/stock/track/{self.tracking.pk}/',
            '/api/stock/track/?export=csv',
            '/api/part/stocktake/',
            f'/api/part/stocktake/{self.snapshot.pk}/',
            '/api/part/stocktake/?export=csv',
        ]

    def test_operator_denied_with_approval_enabled_or_disabled(self):
        """Neither changing workflow settings nor a direct URL bypasses the gate."""
        for enabled in [True, False]:
            set_global_setting('SCAN_APPROVAL_ENABLED', enabled)
            for url in self.urls():
                with self.subTest(enabled=enabled, url=url):
                    self.get(url, expected_code=403)
                    self.options(url, expected_code=403)
            self.post('/api/part/stocktake/', {}, expected_code=403)
            self.post('/api/part/stocktake/generate/', {}, expected_code=403)
        self.get('/api/stock/', expected_code=200)

    def test_approver_can_read_history(self):
        """Approvers can read without gaining stock mutation permissions."""
        addUserPermission(self.user, 'stock', 'scanstockapprovalrequest', 'approve')
        for url in self.urls():
            if 'export=' not in url:
                self.get(url, expected_code=200)

    def test_administrator_retains_access(self):
        """The additional gate preserves existing administrator access."""
        self.user.is_staff = True
        self.user.save()
        for url in self.urls():
            if 'export=' not in url:
                self.get(url, expected_code=200)

    def test_oauth_stock_read_does_not_bypass_approver_gate(self):
        """A scoped OAuth token must still belong to an eligible history viewer."""
        application = Application.objects.create(
            user=self.user,
            client_type=Application.CLIENT_CONFIDENTIAL,
            authorization_grant_type=Application.GRANT_PASSWORD,
            name='History access regression',
        )
        token = 'history-access-regression-token'
        AccessToken.objects.create(
            user=self.user,
            application=application,
            token=token,
            expires=timezone.now() + timedelta(hours=1),
            scope=' '.join(
                [
                    get_granular_scope('view', 'stock'),
                    get_granular_scope('view', 'part'),
                ]
            ),
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        for url in self.urls():
            self.assertEqual(client.get(url).status_code, 403, url)

    def test_business_fields_use_posting_snapshots_and_preserve_zero(self):
        """Never label today's stock metadata as the historical project or balance."""
        event = SimpleNamespace(
            outcome='SUCCESS',
            part_ipn_snapshot='OLD-001',
            part_name_snapshot='Original device',
            batch_snapshot='Original project',
            contract_number_snapshot='Contract A',
            detail_uid_snapshot=None,
            units_snapshot='台',
            operation='OUTBOUND',
            applied_quantity=Decimal(2),
            stock_item_quantity_before=Decimal(2),
            stock_item_quantity_after=Decimal(0),
            source_location_path_snapshot='Old warehouse / Shelf',
            destination_location_path_snapshot='',
            operator_display_name_snapshot='Applicant',
            operator_username_snapshot='operator',
            approver_snapshot='Reviewer',
            purpose='Delivery',
        )
        serializer = StockTrackingSerializer()
        context = serializer.get_wms_context(SimpleNamespace(scan_event=event))
        self.assertEqual(context['project'], 'Original project')
        self.assertEqual(context['quantity_after'], '0')
        self.assertEqual(context['applicant'], 'Applicant')
        self.assertEqual(context['approver'], 'Reviewer')
        self.assertEqual(context['units'], '台')
        self.assertIsNone(serializer.get_wms_context(SimpleNamespace(scan_event=None)))
        event.outcome = 'PENDING'
        self.assertIsNone(serializer.get_wms_context(SimpleNamespace(scan_event=event)))
