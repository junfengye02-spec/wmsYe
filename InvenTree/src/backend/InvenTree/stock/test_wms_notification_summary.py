"""Business summaries for notifications shown in the warehouse UI."""

from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase

from stock.ui_notifications import approval_summary


class WarehouseNotificationSummaryTests(SimpleTestCase):
    """Keep notifications actionable and quantities dimensionally correct."""

    def test_summary_separates_units_and_exposes_transition(self):
        """The drawer title explains the event without mixing metres and devices."""
        request = SimpleNamespace(
            direction='INBOUND',
            reference='SA-123',
            requester_display_name_snapshot='张三',
            requester_username_snapshot='operator',
            location_path_snapshot='成品仓 / A-01',
        )
        lines = [
            SimpleNamespace(
                units_snapshot=unit,
                batch_snapshot='项目一',
                requested_quantity=Decimal(quantity),
            )
            for unit, quantity in [('台', '10.00000'), ('台', '2'), ('米', '1.25000')]
        ]
        name, message = approval_summary(request, 'submitted', lines)
        self.assertIn('入库待审批', name)
        self.assertIn('项目一', name)
        self.assertIn('3 条', name)
        self.assertIn('12 台', name)
        self.assertIn('1.25 米', name)
        self.assertNotIn('13.25', name)
        self.assertIn('SA-123', message)
        self.assertIn('张三', message)
        for event, text in [
            ('approved', '审批通过'),
            ('rejected', '已驳回'),
            ('cancelled', '已撤销'),
            ('expired', '已超时'),
        ]:
            with self.subTest(event=event):
                self.assertIn(text, approval_summary(request, event, lines)[0])

    def test_summary_bounds_long_business_values_and_empty_requests(self):
        """Unusually long names cannot overflow notification model limits."""
        request = SimpleNamespace(
            direction='OUTBOUND',
            reference='SA-456',
            requester_display_name_snapshot='王五\n' * 100,
            requester_username_snapshot='',
            location_path_snapshot='仓库' * 200,
        )
        lines = [
            SimpleNamespace(
                units_snapshot='米',
                batch_snapshot='项目\n' * 100,
                requested_quantity=Decimal('0.10000'),
            )
        ]
        name, message = approval_summary(request, 'approved', lines)
        self.assertIn('出库审批通过', name)
        self.assertNotIn('\n', name + message)
        self.assertLessEqual(len(name), 250)
        self.assertLessEqual(len(message), 250)
        self.assertIn('0 条', approval_summary(request, 'cancelled', [])[0])
