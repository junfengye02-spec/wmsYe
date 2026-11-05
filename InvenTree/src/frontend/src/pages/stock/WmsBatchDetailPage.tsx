import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Timeline,
  Title
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../App';
import PageTitle from '../../components/nav/PageTitle';
import {
  approvalLocationLabel,
  approvalOwnerLabel,
  approvalStatusColor,
  approvalStatusLabel
} from './ScanApprovalRequestDetails';
import type {
  ScanStockApprovalRequest,
  ScanStockEvent
} from './ScanStockTypes';
import { WmsBusinessAttachments } from './WmsBusinessAttachments';
import { cellText, wmsError } from './WmsInventoryPanel';

type BatchLine = ScanStockEvent & { brand?: string; model_number?: string };

export default function WmsBatchDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const query = useQuery<ScanStockApprovalRequest>({
    queryKey: ['scan-stock-request', Number(requestId)],
    enabled: !!requestId && /^\d+$/.test(requestId),
    queryFn: async ({ signal }) =>
      (
        await api.get(
          apiUrl(ApiEndpoints.stock_scan_request_detail, undefined, {
            id: Number(requestId)
          }),
          { signal }
        )
      ).data
  });
  const request = query.data;
  const inbound = request?.direction === 'INBOUND';
  const title = inbound ? t`入库批次明细` : t`出库批次明细`;
  const lines = (request?.lines ?? []).filter(
    (line) => line.outcome === 'SUCCESS'
  ) as BatchLine[];
  const needle = search.trim().toLocaleLowerCase();
  const visible = lines.filter((line) =>
    [
      line.part_name_snapshot,
      line.part_ipn_snapshot,
      line.model_number,
      line.batch_snapshot,
      line.contract_number_snapshot
    ].some((value) => value?.toLocaleLowerCase().includes(needle))
  );
  const units = lines.reduce<Record<string, number>>((totals, line) => {
    const unit = line.units_snapshot || '—';
    totals[unit] = (totals[unit] ?? 0) + Number(line.applied_quantity);
    return totals;
  }, {});
  const lineLocation = (line: BatchLine) =>
    (inbound
      ? line.destination_location_path_snapshot
      : line.source_location_path_snapshot) ||
    (request ? approvalLocationLabel(request) : '—');
  const headers = [
    t`序号`,
    t`设备名称`,
    t`设备编号`,
    t`型号`,
    t`品牌`,
    t`项目`,
    t`合同号`,
    inbound ? t`入库数量` : t`出库数量`,
    t`单位`,
    t`实际库位`,
    t`备注`,
    t`用途`
  ];
  const values = (line: BatchLine, index: number) => [
    index + 1,
    line.part_name_snapshot,
    line.part_ipn_snapshot,
    line.model_number || '—',
    line.brand || '—',
    line.batch_snapshot || '—',
    line.contract_number_snapshot || '—',
    Number(line.applied_quantity),
    line.units_snapshot,
    lineLocation(line),
    line.remark || '—',
    line.purpose || '—'
  ];
  const exportBatch = () => {
    // Export the complete authorized batch, independent of either page's search.
    const csvCell = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [headers, ...lines.map(values)]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `wms-batch-${request?.pk}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Stack gap='md'>
      <PageTitle title={t`批次明细`} />
      <Group>
        <Button
          variant='subtle'
          size='compact-sm'
          onClick={() =>
            navigate('/stock/statistics/', {
              state: location.state?.statisticsState
            })
          }
        >{t`返回统计查询`}</Button>
      </Group>
      {query.isError ? (
        <Alert color='red'>{wmsError(query.error)}</Alert>
      ) : !request ? (
        query.isPending && query.fetchStatus !== 'idle' ? (
          <Loader />
        ) : (
          <Alert>{t`批次编号无效`}</Alert>
        )
      ) : (
        <>
          <Group justify='space-between'>
            <Group gap='sm'>
              <Title order={2}>{title}</Title>
              <Badge color={approvalStatusColor(request.status)}>
                {request.status === 'COMPLETED'
                  ? inbound
                    ? t`已入库`
                    : t`已出库`
                  : approvalStatusLabel(request.status)}
              </Badge>
            </Group>
            <Button
              variant='default'
              disabled={!lines.length}
              onClick={exportBatch}
            >{t`导出本批明细`}</Button>
          </Group>
          <Paper withBorder p='sm' radius='sm'>
            <Stack gap='xs'>
              <Group gap='xl'>
                <Text size='sm'>
                  {t`申请单号`}：{request.reference}
                </Text>
                <Text size='sm'>
                  {inbound ? t`入库时间` : t`出库时间`}：
                  {cellText(
                    'completed_at',
                    lines[0]?.completed_at || request.decided_at || ''
                  )}
                </Text>
                <Text size='sm'>
                  {t`申请人`}：
                  {request.requester_display_name_snapshot ||
                    request.requester_username_snapshot}
                </Text>
                <Text size='sm'>
                  {t`审核人`}：
                  {lines[0]?.approver_snapshot || approvalOwnerLabel(request)}
                </Text>
              </Group>
              <Text size='sm'>
                {t`实际库位`}：{approvalLocationLabel(request)}
              </Text>
            </Stack>
          </Paper>
          <Tabs defaultValue='details' keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value='details'>
                {t`设备明细`}（{lines.length}）
              </Tabs.Tab>
              <Tabs.Tab value='attachments'>
                {inbound ? t`到货单附件` : t`出库单附件`}
              </Tabs.Tab>
              <Tabs.Tab value='approval'>{t`审批记录`}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value='details' pt='md'>
              <Stack gap='sm'>
                <Group justify='space-between'>
                  <TextInput
                    aria-label={t`搜索本批明细`}
                    placeholder={t`输入设备名称 / 型号 / 编号`}
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    w={360}
                    maw='100%'
                  />
                  <Text size='sm'>
                    {t`本批全部明细`}：{lines.length} {t`条`} · {t`数量合计`}：
                    {Object.entries(units)
                      .map(
                        ([unit, quantity]) =>
                          `${Number(quantity.toFixed(5))} ${unit}`
                      )
                      .join('；') || '—'}
                  </Text>
                </Group>
                <Table.ScrollContainer minWidth={1000}>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        {headers
                          .filter((_, index) => ![8, 10, 11].includes(index))
                          .map((label) => (
                            <Table.Th key={label}>{label}</Table.Th>
                          ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {visible.map((line) => (
                        <Table.Tr key={line.pk}>
                          <Table.Td>{lines.indexOf(line) + 1}</Table.Td>
                          <Table.Td>
                            {line.part_name_snapshot || '—'}
                            {line.remark && (
                              <Text size='xs' c='dimmed'>
                                {t`备注`}：{line.remark}
                              </Text>
                            )}
                            {line.purpose && (
                              <Text size='xs' c='dimmed'>
                                {t`用途`}：{line.purpose}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>{line.part_ipn_snapshot || '—'}</Table.Td>
                          <Table.Td>{line.model_number || '—'}</Table.Td>
                          <Table.Td>{line.brand || '—'}</Table.Td>
                          <Table.Td>{line.batch_snapshot || '—'}</Table.Td>
                          <Table.Td>
                            {line.contract_number_snapshot || '—'}
                          </Table.Td>
                          <Table.Td style={{ whiteSpace: 'nowrap' }}>
                            {Number(line.applied_quantity)}{' '}
                            {line.units_snapshot}
                          </Table.Td>
                          <Table.Td>{lineLocation(line)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                <Text size='sm' c='dimmed'>
                  {visible.length
                    ? `${t`显示`} ${visible.length} / ${lines.length} ${t`条明细`}`
                    : t`没有符合条件的明细`}
                </Text>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value='attachments' pt='md'>
              <WmsBusinessAttachments
                requestId={request.pk}
                direction={request.direction}
              />
            </Tabs.Panel>
            <Tabs.Panel value='approval' pt='md'>
              <Timeline active={3} bulletSize={16}>
                <Timeline.Item title={t`创建申请`}>
                  <Text size='sm'>
                    {cellText('completed_at', request.created_at)}
                  </Text>
                </Timeline.Item>
                <Timeline.Item title={t`提交审批`}>
                  <Text size='sm'>
                    {cellText('completed_at', request.submitted_at || '')}
                  </Text>
                </Timeline.Item>
                <Timeline.Item title={approvalStatusLabel(request.status)}>
                  <Text size='sm'>
                    {cellText('completed_at', request.decided_at || '')}
                  </Text>
                  <Text size='sm'>{request.decision_note || '—'}</Text>
                </Timeline.Item>
              </Timeline>
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  );
}
