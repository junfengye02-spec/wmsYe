import { t } from '@lingui/core/macro';
import {
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { pendingScanGroups, sumScanQuantities } from './ScanPendingGroups';
import type {
  ScanStockApprovalRequest,
  ScanStockEvent
} from './ScanStockTypes';
import { WmsBusinessAttachments } from './WmsBusinessAttachments';

type Equipment = ScanStockEvent & { brand?: string; model_number?: string };
export function ScanApprovalReview({
  request,
  actions,
  statusLabel,
  statusColor,
  owner,
  location,
  history,
  canRemove,
  removeLine
}: {
  request: ScanStockApprovalRequest;
  actions: ReactNode;
  statusLabel: string;
  statusColor: string;
  owner: string;
  location: string;
  history: ReactNode;
  canRemove: boolean;
  removeLine: (line: ScanStockEvent) => void;
}) {
  const [search, setSearch] = useState('');
  const lines = request.lines ?? [];
  const active = lines.filter(
    (line) => line.outcome === 'PENDING' || line.outcome === 'SUCCESS'
  );
  const groups = pendingScanGroups(active, true);
  const rows = [
    ...groups.map((group) => ({
      line: group.latest as Equipment,
      quantity: group.quantity,
      count: group.members.length
    })),
    ...active
      .filter((line) => line.outcome === 'SUCCESS')
      .map((line) => ({
        line: line as Equipment,
        quantity: line.applied_quantity,
        count: 1
      }))
  ];
  const totals: Record<string, string> = {};
  for (const row of rows) {
    const unit = row.line.units_snapshot || '—';
    totals[unit] = sumScanQuantities([totals[unit] || '0', row.quantity]);
  }
  const needle = search.trim().toLocaleLowerCase();
  const visible = rows.filter(({ line }) =>
    [
      line.part_name_snapshot,
      line.part_ipn_snapshot,
      line.model_number,
      line.batch_snapshot,
      line.contract_number_snapshot
    ].some((value) => value?.toLocaleLowerCase().includes(needle))
  );
  const headers = [
    t`序号`,
    t`设备名称 / 编号`,
    t`型号`,
    t`品牌`,
    t`项目`,
    t`合同号`,
    request.status === 'COMPLETED' ? t`实际数量` : t`申请数量`,
    t`实际库位`,
    t`用途`,
    t`备注`
  ];
  const values = ({ line, quantity }: (typeof rows)[number], index: number) => [
    index + 1,
    `${line.part_name_snapshot || '—'} / ${line.part_ipn_snapshot || '—'}`,
    line.model_number || '—',
    line.brand || '—',
    line.batch_snapshot || '—',
    line.contract_number_snapshot || '—',
    `${quantity} ${line.units_snapshot}`,
    (request.direction === 'INBOUND'
      ? line.destination_location_path_snapshot
      : line.source_location_path_snapshot) || location,
    line.purpose || '—',
    line.remark || '—'
  ];
  const exportRows = () => {
    const cell = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const csv = [headers, ...rows.map(values)]
      .map((row) => row.map(cell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `wms-approval-${request.pk}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const time = (value?: string | null) =>
    value ? new Date(value).toLocaleString() : '—';
  return (
    <Stack gap='md'>
      <Group justify='space-between'>
        <Group>
          <Title order={2}>
            {request.direction === 'INBOUND' ? t`入库审批单` : t`出库审批单`}
          </Title>
          <Badge color={statusColor}>{statusLabel}</Badge>
        </Group>
        <Group>
          <Button
            variant='default'
            onClick={exportRows}
            disabled={!rows.length}
          >{t`导出明细`}</Button>
        </Group>
      </Group>
      <Paper withBorder p='sm'>
        <Stack gap='xs'>
          <Group gap='xl'>
            <Text size='sm'>
              {t`申请单号`}：{request.reference}
            </Text>
            <Text size='sm'>
              {t`Requester`}：
              {request.requester_display_name_snapshot ||
                request.requester_username_snapshot}
            </Text>
            <Text size='sm'>
              {t`Submitted`}：{time(request.submitted_at)}
            </Text>
            <Text size='sm'>
              {t`Approval route`}：{owner}
            </Text>
          </Group>
          <Group gap='xl'>
            <Text size='sm'>
              {t`实际库位`}：{location}
            </Text>
            <Text size='sm'>
              {t`Expires`}：{time(request.expires_at)}
            </Text>
          </Group>
        </Stack>
      </Paper>
      <Tabs defaultValue='details' keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value='details'>
            {t`设备明细`}（{rows.length}）
          </Tabs.Tab>
          <Tabs.Tab value='attachments'>
            {request.direction === 'INBOUND' ? t`到货单附件` : t`出库单附件`}
          </Tabs.Tab>
          <Tabs.Tab value='history'>{t`审批记录`}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value='details' pt='md'>
          <Stack gap='sm'>
            <Group justify='space-between'>
              <TextInput
                aria-label={t`搜索明细`}
                placeholder={t`搜索设备名称 / 型号 / 编号`}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                w={360}
                maw='100%'
              />
              <Text size='sm'>
                {t`明细`}：{rows.length} · {t`数量合计`}：
                {Object.entries(totals)
                  .map(([unit, quantity]) => `${quantity} ${unit}`)
                  .join('、') || '0'}
              </Text>
            </Group>
            <ScrollArea>
              <Table striped highlightOnHover withTableBorder miw={1100}>
                <Table.Thead>
                  <Table.Tr>
                    {headers.map((header) => (
                      <Table.Th key={header}>{header}</Table.Th>
                    ))}
                    {canRemove && <Table.Th>{t`操作`}</Table.Th>}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visible.map((row, index) => (
                    <Table.Tr key={row.line.pk}>
                      {values(row, index).map((value, column) => (
                        <Table.Td key={headers[column]}>
                          {column === 1 ? (
                            <>
                              <Text fw={600} size='sm'>
                                {row.line.part_name_snapshot || '—'}
                              </Text>
                              <Text size='xs' c='dimmed'>
                                {row.line.part_ipn_snapshot}
                              </Text>
                            </>
                          ) : column === 6 ? (
                            <>
                              <Text fw={600} size='sm'>
                                {value}
                              </Text>
                              {row.count > 1 && (
                                <Text size='xs' c='dimmed'>
                                  {t`累计扫码`} {row.count} {t`次`}
                                </Text>
                              )}
                            </>
                          ) : (
                            value
                          )}
                        </Table.Td>
                      ))}
                      {canRemove && (
                        <Table.Td>
                          {row.line.outcome === 'PENDING' && (
                            <Button
                              size='compact-xs'
                              color='red'
                              variant='subtle'
                              onClick={() => removeLine(row.line)}
                            >
                              {row.count > 1 ? t`撤销最近一次` : t`Remove`}
                            </Button>
                          )}
                        </Table.Td>
                      )}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
            <Text size='sm' c='dimmed'>
              {t`显示`} {visible.length} / {rows.length} {t`条明细`}
            </Text>
            {!rows.length && (
              <Text c='dimmed'>{t`无有效明细，历史明细请查看审批记录。`}</Text>
            )}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value='attachments' pt='md'>
          <WmsBusinessAttachments
            requestId={request.pk}
            direction={request.direction}
          />
        </Tabs.Panel>
        <Tabs.Panel value='history' pt='md'>
          {history}
          <Table mt='md' striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t`设备名称`}</Table.Th>
                <Table.Th>{t`数量`}</Table.Th>
                <Table.Th>{t`Reason`}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines
                .filter(
                  (line) =>
                    line.outcome !== 'PENDING' && line.outcome !== 'SUCCESS'
                )
                .map((line) => (
                  <Table.Tr key={line.pk}>
                    <Table.Td>
                      {line.part_name_snapshot} / {line.part_ipn_snapshot}
                    </Table.Td>
                    <Table.Td>
                      {line.requested_quantity} {line.units_snapshot}
                    </Table.Td>
                    <Table.Td>{line.terminal_reason || '—'}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>
      <Paper
        withBorder
        p='sm'
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          background: 'var(--mantine-color-body)'
        }}
      >
        <Group justify='space-between'>
          <Text size='sm'>
            {statusLabel} · {t`核对设备、合同和数量后审批`}
          </Text>
          {actions}
        </Group>
      </Paper>
    </Stack>
  );
}
