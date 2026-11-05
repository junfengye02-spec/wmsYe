"""Shared sizing for the 50 x 30 mm equipment label and browser preview."""

import math
import unicodedata


def equipment_label_font_size(part):
    """Fit every printed field inside the text column without clipping it."""
    # Full-width colons match the Chinese text printed on the label.
    fields = [
        part.name,
        f'品牌：{part.brand or "—"}',  # noqa: RUF001
        f'规格：{part.specification or "—"}',  # noqa: RUF001
        f'型号：{part.model_number or "—"}',  # noqa: RUF001
    ]
    widths = [
        sum(1 if unicodedata.east_asian_width(char) in 'WF' else 0.7 for char in field)
        for field in fields
    ]
    # 23 mm column, 21 mm height. Reserve space between fields and use a
    # conservative glyph width so CJK, Latin and unbroken model codes all fit.
    for tenths in range(70, 14, -1):
        size = tenths / 10
        lines = sum(max(1, math.ceil(width * size / 63)) for width in widths)
        if lines * size * 1.2 + 4 <= 59:
            return size
    return 1.5
