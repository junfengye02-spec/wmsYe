"""Sizing for the standard equipment label."""

from django import template

from report.label_layout import equipment_label_font_size

register = template.Library()
register.filter('equipment_label_font_size', equipment_label_font_size)
