"""Real PDF layout checks for complete and basic equipment labels."""

import io
from types import SimpleNamespace

from django.template.loader import render_to_string
from django.test import SimpleTestCase

from pypdf import PdfReader
from weasyprint import HTML


class EquipmentLabelLayoutTests(SimpleTestCase):
    """All visible fields and the QR quiet zone must fit on a single label."""

    def test_labels_keep_all_fields_inside_printable_margins(self):
        """Long Chinese text and unbroken model codes never cross the paper edge."""
        parts = [
            SimpleNamespace(
                name='小米14',
                brand='小米',
                specification='12GB + 256GB',
                model_number='23127PN0CC',
            ),
            SimpleNamespace(
                name='10P-POE-网管型交换机',
                brand='测试品牌',
                specification='8口千兆 + 2光口',
                model_number='NSBDNSBDkdgjrcsq010kdgjrcsq00001',
            ),
            SimpleNamespace(
                name='设备名称' * 25,
                brand='测试品牌' * 25,
                specification='设备规格参数' * 41 + '规格参数',
                model_number='MODEL12345' * 10,
            ),
        ]
        for part in parts:
            for name in ('wms_complete_receipt', 'product_ipn_qr'):
                with self.subTest(name=name, length=len(part.specification)):
                    html = render_to_string(
                        f'label/{name}.html',
                        {
                            'width': 50,
                            'height': 30,
                            'page_style': '@page { size: 50mm 30mm; margin: 0; }',
                            'part': part,
                            'complete_barcode': 'WMS1:47F10C0F07774F8595DDCE0A81592994:1',
                            'product_ipn': 'DEVICE-001',
                        },
                    )
                    document = HTML(string=html).render()
                    self.assertEqual(len(document.pages), 1)
                    for box in document.pages[0]._page_box.descendants():
                        if getattr(box, 'text', '') or box.element_tag == 'img':
                            self.assertGreaterEqual(box.position_x, 1.9 * 96 / 25.4)
                            self.assertLessEqual(
                                box.position_x + box.width, 48.1 * 96 / 25.4
                            )
                            self.assertGreaterEqual(box.position_y, 1.4 * 96 / 25.4)
                            self.assertLessEqual(
                                box.position_y + box.height, 28.1 * 96 / 25.4
                            )
                    text = (
                        PdfReader(io.BytesIO(document.write_pdf()))
                        .pages[0]
                        .extract_text()
                    )
                    compact = ''.join(text.split())
                    for field in (
                        part.name,
                        part.brand,
                        part.specification,
                        part.model_number,
                        '广州南沙智慧城市大数据有限公司',
                    ):
                        self.assertIn(''.join(field.split()), compact)
                    self.assertNotIn('IPN:', text)
