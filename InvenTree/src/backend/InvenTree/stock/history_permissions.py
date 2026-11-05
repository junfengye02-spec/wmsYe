"""Access control shared by native stock history and tracking endpoints."""

from rest_framework.permissions import BasePermission


class StockHistoryPermission(BasePermission):
    """Require an administrator or warehouse approver, even for OAuth reads."""

    message = '仅管理员和审批员可以查看库存历史与库存流水。'

    def has_permission(self, request, view):
        """Apply the warehouse audience restriction in addition to normal roles."""
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.is_active
            and (
                user.is_staff
                or user.is_superuser
                or user.has_perm('stock.approve_scanstockapprovalrequest')
            )
        )


class StockHistoryAccessMixin:
    """Keep the original role and token checks and add the history restriction."""

    def get_permissions(self):
        """Do not allow a generic stock read permission to expose history."""
        return [*super().get_permissions(), StockHistoryPermission()]
