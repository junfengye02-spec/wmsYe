"""Compact warehouse notification summaries using posted business snapshots."""

from collections import defaultdict
from decimal import Decimal


def approval_summary(request, event_name, lines):
    """Describe the transition without adding quantities with different units."""
    statuses = {
        'submitted': '待审批',
        'approved': '审批通过',
        'rejected': '已驳回',
        'cancelled': '已撤销',
        'expired': '已超时',
    }
    direction = '入库' if request.direction == 'INBOUND' else '出库'
    status = statuses.get(event_name, '状态更新')
    quantities = defaultdict(Decimal)
    projects = []
    count = 0
    for line in lines:
        count += 1
        unit = ' '.join((line.units_snapshot or '未注明单位').split())
        quantities[unit] += line.requested_quantity
        project = ' '.join((line.batch_snapshot or '未填写项目').split())
        if project not in projects:
            projects.append(project)
    project_text = ' / '.join(projects[:2])[:60]
    if len(projects) > 2:
        project_text += f' 等 {len(projects)} 个项目'
    quantity_text = '、'.join(
        f'{format(value, "f").rstrip("0").rstrip(".") if value % 1 else int(value)} {unit}'
        for unit, value in sorted(quantities.items())
    )
    summary = f'{direction}{status} · {project_text or "无明细"} · {count} 条'
    if quantity_text:
        summary += f' · {quantity_text}'
    name = summary[:250]
    actor = (
        request.requester_display_name_snapshot
        or request.requester_username_snapshot
        or '历史未填写'
    )
    message = f'{request.reference} · 申请人: {actor} · 库位: {request.location_path_snapshot}'
    return name, ' '.join(message.split())[:250]
