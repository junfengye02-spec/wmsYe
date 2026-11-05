import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Table,
  Text,
  Textarea,
  Timeline,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconClock,
  IconSend,
  IconX
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, queryClient } from '../../App';
import { useUserState } from '../../states/UserState';
import { ScanApprovalReview } from './ScanApprovalReview';
import { pendingScanGroups, sumScanQuantities } from './ScanPendingGroups';
import type {
  ScanApprovalActionResponse,
  ScanApprovalStatus,
  ScanStockApprovalRequest,
  ScanStockEvent
} from './ScanStockTypes';
import { WmsBusinessAttachments } from './WmsBusinessAttachments';

type DecisionAction = 'approve' | 'reject' | 'cancel';

function displayTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function approvalStatusLabel(status: ScanApprovalStatus): string {
  switch (status) {
    case 'DRAFT':
      return t`Draft`;
    case 'PENDING_APPROVAL':
      return t`Pending approval`;
    case 'APPLYING':
      return t`Applying`;
    case 'COMPLETED':
      return t`Completed`;
    case 'REJECTED':
      return t`Rejected`;
    case 'CANCELLED':
      return t`Cancelled`;
    case 'EXPIRED':
      return t`Expired`;
  }
}

export function approvalStatusColor(status: ScanApprovalStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'green';
    case 'PENDING_APPROVAL':
    case 'APPLYING':
      return 'yellow';
    case 'REJECTED':
    case 'CANCELLED':
    case 'EXPIRED':
      return 'red';
    default:
      return 'blue';
  }
}

export function approvalOwnerLabel(request: ScanStockApprovalRequest): string {
  const snapshot = request.approval_owner_snapshot;
  if (typeof snapshot === 'string') return snapshot;
  return snapshot?.name || t`Not assigned`;
}

export function approvalLocationLabel(
  request: ScanStockApprovalRequest
): string {
  return request.location_path_snapshot || `#${request.location}`;
}

export function approvalRequestLines(
  request?: ScanStockApprovalRequest
): ScanStockEvent[] {
  return request?.lines ?? [];
}

function actionErrorData(error: any): Partial<ScanApprovalActionResponse> {
  return error?.response?.data ?? error?.data ?? {};
}

function actionEndpoint(action: DecisionAction, requestId: number): string {
  const endpoint =
    action === 'approve'
      ? ApiEndpoints.stock_scan_request_approve
      : action === 'reject'
        ? ApiEndpoints.stock_scan_request_reject
        : ApiEndpoints.stock_scan_request_cancel;
  return apiUrl(endpoint, undefined, { id: requestId });
}

function TimelineEntry({
  label,
  value,
  color = 'blue'
}: Readonly<{ label: string; value?: string | null; color?: string }>) {
  if (!value) return null;
  return (
    <Timeline.Item title={label} color={color} bullet={<IconClock size={13} />}>
      <Text size='sm' c='dimmed'>
        {displayTime(value)}
      </Text>
    </Timeline.Item>
  );
}

export function ScanApprovalRequestDetails({
  requestId,
  initialRequest,
  onChanged,
  hideSubmit = false,
  compact = false
}: Readonly<{
  requestId: number;
  initialRequest?: ScanStockApprovalRequest;
  onChanged?: (request: ScanStockApprovalRequest) => void;
  hideSubmit?: boolean;
  compact?: boolean;
}>) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!compact) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [compact]);
  const currentUserId = useUserState((state) => state.userId());
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decisionAction, setDecisionAction] = useState<DecisionAction | null>(
    null
  );
  const [decisionNote, setDecisionNote] = useState('');

  const requestQuery = useQuery<ScanStockApprovalRequest>({
    queryKey: ['scan-stock-request', requestId],
    queryFn: async () => {
      const response = await api.get<ScanStockApprovalRequest>(
        apiUrl(ApiEndpoints.stock_scan_request_detail, undefined, {
          id: requestId
        })
      );
      return response.data;
    },
    initialData: initialRequest
  });

  const request = requestQuery.data;
  const lines = approvalRequestLines(request);
  const pendingLines = lines
    .filter((line) => line.outcome === 'PENDING')
    .sort((a, b) => b.pk - a.pk);
  const pendingGroups = pendingScanGroups(pendingLines, compact);
  const latestLineId = pendingLines[0]?.pk;
  const pendingViewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compact) pendingViewport.current?.scrollTo({ top: 0 });
  }, [compact, latestLineId]);

  const refreshRelatedData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['scan-stock-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['scan-stock-events'] }),
      queryClient.invalidateQueries({ queryKey: ['scan-stock-active-draft'] }),
      queryClient.invalidateQueries({ queryKey: ['scan-stock-request'] }),
      queryClient.invalidateQueries({ queryKey: ['table-data'] }),
      queryClient.invalidateQueries({ queryKey: ['wms-project-options'] }),
      queryClient.invalidateQueries({ queryKey: ['wms-options'] })
    ]);
  };

  const submitRequest = async () => {
    if (!request) return;
    setProcessing(true);
    setActionError(null);
    try {
      const response = await api.post<ScanStockApprovalRequest>(
        apiUrl(ApiEndpoints.stock_scan_request_submit, undefined, {
          id: request.pk
        })
      );
      queryClient.setQueryData(
        ['scan-stock-request', request.pk],
        response.data
      );
      await refreshRelatedData();
      onChanged?.(response.data);
      notifications.show({
        color: 'green',
        message: t`Approval request submitted.`
      });
    } catch (error) {
      const data = actionErrorData(error);
      setActionError(
        data.error_message || t`The request could not be submitted.`
      );
      await requestQuery.refetch();
    } finally {
      setProcessing(false);
    }
  };

  const performDecision = async () => {
    if (!request || !decisionAction) return;
    if (
      (decisionAction === 'reject' ||
        (decisionAction === 'cancel' &&
          request.status === 'PENDING_APPROVAL')) &&
      !decisionNote.trim()
    ) {
      setActionError(t`A reason is required.`);
      return;
    }

    setProcessing(true);
    setActionError(null);
    try {
      const payload = { note: decisionNote.trim() };
      const response = await api.post<ScanStockApprovalRequest>(
        actionEndpoint(decisionAction, request.pk),
        payload
      );
      queryClient.setQueryData(
        ['scan-stock-request', request.pk],
        response.data
      );
      await refreshRelatedData();
      onChanged?.(response.data);
      setDecisionAction(null);
      setDecisionNote('');
      notifications.show({
        color: 'green',
        message:
          decisionAction === 'approve'
            ? t`Approval request completed.`
            : decisionAction === 'reject'
              ? t`Approval request rejected.`
              : t`Approval request cancelled.`
      });
    } catch (error) {
      const data = actionErrorData(error);
      const conflict = (error as any)?.response?.status === 409;
      setActionError(
        data.error_message ||
          (conflict
            ? t`The request changed on the server. Its latest status has been loaded.`
            : t`The request action failed.`)
      );
      await requestQuery.refetch();
      await refreshRelatedData();
      if (conflict) {
        setDecisionAction(null);
        setDecisionNote('');
      }
    } finally {
      setProcessing(false);
    }
  };

  const removeLine = async (line: ScanStockEvent) => {
    if (!request) return;
    setProcessing(true);
    setActionError(null);
    try {
      const response = await api.delete<ScanStockApprovalRequest>(
        apiUrl(ApiEndpoints.stock_scan_request_lines, undefined, {
          id: request.pk,
          event_pk: line.pk
        })
      );
      queryClient.setQueryData(
        ['scan-stock-request', request.pk],
        response.data
      );
      await refreshRelatedData();
      onChanged?.(response.data);
    } catch (error) {
      const data = actionErrorData(error);
      setActionError(
        data.error_message || t`The request line could not be removed.`
      );
      await requestQuery.refetch();
    } finally {
      setProcessing(false);
    }
  };

  if (requestQuery.isError) {
    return (
      <Alert color='red'>{t`The approval request could not be loaded.`}</Alert>
    );
  }

  if (requestQuery.isLoading || !request) {
    return (
      <Group justify='center' py='xl'>
        <Loader />
        <Text c='dimmed'>{t`Loading approval request…`}</Text>
      </Group>
    );
  }

  const isOwnRequest = request.requester === currentUserId;
  const canSubmit =
    request.status === 'DRAFT' && isOwnRequest && request.active_line_count > 0;
  const canCancel =
    ['DRAFT', 'PENDING_APPROVAL'].includes(request.status) &&
    request.can_cancel;
  const canApprove =
    request.status === 'PENDING_APPROVAL' &&
    !isOwnRequest &&
    request.can_approve;
  const canReject =
    request.status === 'PENDING_APPROVAL' &&
    !isOwnRequest &&
    request.can_approve;

  const unitTotals = pendingGroups.reduce<Record<string, string>>(
    (totals, group) => {
      const unit = group.latest.units_snapshot || '—';
      totals[unit] = sumScanQuantities([totals[unit] || '0', group.quantity]);
      return totals;
    },
    {}
  );
  const remainingMinutes = Math.max(
    0,
    Math.ceil((new Date(request.expires_at).getTime() - now) / 60000)
  );
  const requestActions = (
    <Group gap='xs'>
      {canSubmit && !hideSubmit && (
        <Button
          leftSection={<IconSend size={16} />}
          loading={processing}
          onClick={() => void submitRequest()}
        >
          {t`Submit for approval`}
        </Button>
      )}
      {canApprove && (
        <Button
          color='green'
          leftSection={<IconCheck size={16} />}
          onClick={() => {
            setActionError(null);
            setDecisionAction('approve');
          }}
        >
          {t`Approve`}
        </Button>
      )}
      {canReject && (
        <Button
          color='red'
          variant='light'
          leftSection={<IconX size={16} />}
          onClick={() => {
            setActionError(null);
            setDecisionAction('reject');
          }}
        >
          {t`Reject`}
        </Button>
      )}
      {canCancel && (
        <Button
          color='red'
          variant='subtle'
          leftSection={<IconBan size={16} />}
          onClick={() => {
            setActionError(null);
            setDecisionAction('cancel');
          }}
        >
          {t`Cancel request`}
        </Button>
      )}
    </Group>
  );

  return (
    <Stack gap={compact ? 'sm' : 'lg'}>
      {compact && (
        <>
          <Group justify='space-between' align='flex-start'>
            <div>
              <Group gap='xs'>
                <Title order={compact ? 4 : 2}>
                  {compact
                    ? request.direction === 'INBOUND'
                      ? t`待入库明细`
                      : t`待出库明细`
                    : request.reference}
                </Title>
                <Badge color={approvalStatusColor(request.status)}>
                  {approvalStatusLabel(request.status)}
                </Badge>
              </Group>
              <Text c='dimmed' size='sm'>
                {compact
                  ? `${t`草稿自动保存`} · ${remainingMinutes ? `${t`剩余`} ${remainingMinutes} ${t`分钟`}` : t`已到期，请刷新明细`}`
                  : approvalLocationLabel(request)}
              </Text>
            </div>
            {!compact && requestActions}
          </Group>

          {actionError && decisionAction === null && (
            <Alert color='red' icon={<IconAlertCircle size={18} />}>
              {actionError}
            </Alert>
          )}
          {request.last_approval_error && (
            <Alert color='orange' title={t`Last approval error`}>
              {request.last_approval_error}
            </Alert>
          )}

          {lines.length === 0 ? (
            <Alert variant='light'>{t`This request has no active lines.`}</Alert>
          ) : compact ? (
            <ScrollArea.Autosize
              mah='clamp(160px, calc(100dvh - 470px), 520px)'
              viewportRef={pendingViewport}
              type='auto'
            >
              <Table striped highlightOnHover miw={900} stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    {[
                      t`设备名称`,
                      t`型号`,
                      t`品牌`,
                      t`项目`,
                      t`合同号`,
                      t`数量`,
                      t`实际库位`,
                      t`操作`
                    ].map((label) => (
                      <Table.Th key={label}>{label}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pendingGroups.map((group) => {
                    const line = group.latest;
                    const equipment = line as ScanStockEvent & {
                      brand?: string;
                      model_number?: string;
                    };
                    return (
                      <Table.Tr
                        key={group.key}
                        bg={
                          line.pk === latestLineId
                            ? 'var(--mantine-color-blue-light)'
                            : undefined
                        }
                      >
                        <Table.Td>
                          {line.part_name_snapshot}
                          <Text size='xs' c='dimmed'>
                            {line.part_ipn_snapshot}
                          </Text>
                        </Table.Td>
                        <Table.Td>{equipment.model_number || '—'}</Table.Td>
                        <Table.Td>{equipment.brand || '—'}</Table.Td>
                        <Table.Td>{line.batch_snapshot || '—'}</Table.Td>
                        <Table.Td>
                          {line.contract_number_snapshot || t`历史未填写`}
                        </Table.Td>
                        <Table.Td>
                          {group.quantity} {line.units_snapshot}
                          {group.members.length > 1 && (
                            <Text size='xs' c='dimmed'>
                              {t`累计扫码`} {group.members.length} {t`次`}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          {(request.direction === 'INBOUND'
                            ? line.destination_location_path_snapshot
                            : line.source_location_path_snapshot) ||
                            approvalLocationLabel(request)}
                        </Table.Td>
                        <Table.Td>
                          {isOwnRequest && request.status === 'DRAFT' && (
                            <Button
                              size='compact-xs'
                              color='red'
                              variant='subtle'
                              loading={processing}
                              onClick={() => void removeLine(line)}
                            >
                              {group.members.length > 1
                                ? t`撤销最近一次`
                                : t`Remove`}
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          ) : null}

          {compact && (
            <Group justify='space-between'>
              <Text size='sm'>
                {t`明细`}：{pendingGroups.length} ·{' '}
                {Object.entries(unitTotals)
                  .map(([unit, quantity]) => `${quantity} ${unit}`)
                  .join('、') || '0'}
              </Text>
              {requestActions}
            </Group>
          )}

          <WmsBusinessAttachments
            compact={compact}
            requestId={request.pk}
            direction={request.direction}
          />
        </>
      )}
      {!compact && (
        <>
          {actionError && decisionAction === null && (
            <Alert color='red'>{actionError}</Alert>
          )}
          {request.last_approval_error && (
            <Alert color='orange' title={t`Last approval error`}>
              {request.last_approval_error}
            </Alert>
          )}
          <ScanApprovalReview
            key={request.pk}
            request={request}
            actions={requestActions}
            statusLabel={approvalStatusLabel(request.status)}
            statusColor={approvalStatusColor(request.status)}
            owner={approvalOwnerLabel(request)}
            location={approvalLocationLabel(request)}
            canRemove={
              isOwnRequest && request.status === 'DRAFT' && !processing
            }
            removeLine={(line) => void removeLine(line)}
            history={
              <Stack>
                {' '}
                <Timeline active={4} bulletSize={24} lineWidth={2}>
                  <TimelineEntry
                    label={t`Created`}
                    value={request.created_at}
                  />
                  <TimelineEntry
                    label={t`Submitted`}
                    value={request.submitted_at}
                  />
                  <TimelineEntry
                    label={t`Decided`}
                    value={request.decided_at}
                    color={request.status === 'COMPLETED' ? 'green' : 'red'}
                  />
                  <TimelineEntry
                    label={t`Cancelled`}
                    value={request.cancelled_at}
                    color='red'
                  />
                  <TimelineEntry
                    label={t`Expires`}
                    value={request.expires_at}
                    color='orange'
                  />
                </Timeline>
                {(request.decision_note || request.cancel_note) && (
                  <Alert variant='light'>
                    {request.decision_note || request.cancel_note}
                  </Alert>
                )}
              </Stack>
            }
          />
        </>
      )}

      <Modal
        opened={decisionAction !== null}
        onClose={() => {
          if (!processing) {
            setDecisionAction(null);
            setDecisionNote('');
          }
        }}
        title={
          decisionAction === 'approve'
            ? t`Approve request`
            : decisionAction === 'reject'
              ? t`Reject request`
              : t`Cancel request`
        }
        centered
        closeOnClickOutside={!processing}
      >
        <Stack>
          {actionError && (
            <Alert color='red' icon={<IconAlertCircle size={18} />}>
              {actionError}
            </Alert>
          )}
          <Alert
            color={decisionAction === 'approve' ? 'green' : 'red'}
            icon={<IconAlertCircle size={18} />}
          >
            {decisionAction === 'approve'
              ? t`All request lines will be applied in one transaction.`
              : t`Outbound reservations will be released and this request cannot be restored.`}
          </Alert>
          <Textarea
            required={
              decisionAction === 'reject' ||
              (decisionAction === 'cancel' &&
                request.status === 'PENDING_APPROVAL')
            }
            label={decisionAction === 'approve' ? t`Decision note` : t`Reason`}
            value={decisionNote}
            onChange={(event) => {
              setDecisionNote(event.currentTarget.value);
              setActionError(null);
            }}
            minRows={3}
          />
          <Group justify='flex-end'>
            <Button
              variant='default'
              disabled={processing}
              onClick={() => {
                setDecisionAction(null);
                setDecisionNote('');
              }}
            >
              {t`Back`}
            </Button>
            <Button
              color={decisionAction === 'approve' ? 'green' : 'red'}
              loading={processing}
              onClick={() => void performDecision()}
            >
              {t`Confirm`}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
