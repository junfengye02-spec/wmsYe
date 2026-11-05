import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Group,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../App';
import type { WmsReceipt } from './WmsContractTypes';
import { wmsUrl } from './WmsInventoryPanel';
import { WmsReceiptWorkbench } from './WmsReceiptWorkbench';

export function WmsReceiptManager() {
  const [selected, setSelected] = useState<number | null | undefined>(
    undefined
  );
  const [filters, setFilters] = useState({
    number: '',
    project: '',
    contract: '',
    start: '',
    end: '',
    status: ''
  });
  const [stable] = useDebouncedValue(filters, 200);
  const [page, setPage] = useState(1);
  const receipts = useQuery<{ count: number; results: WmsReceipt[] }>({
    queryKey: ['wms-receipts', 'management', stable, page],
    enabled: selected === undefined,
    queryFn: async () =>
      (
        await api.get(wmsUrl('receipts'), {
          params: {
            ...stable,
            manage: true,
            limit: 25,
            offset: (page - 1) * 25
          }
        })
      ).data
  });
  const statuses = [
    { value: 'READY', label: t`待入库` },
    { value: 'IN_REQUEST', label: t`申请中` },
    { value: 'PARTIAL', label: t`部分入库` },
    { value: 'RECEIVED', label: t`已入库` },
    { value: 'CANCELLED', label: t`已作废` }
  ];
  const change = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  if (selected !== undefined)
    return (
      <Stack>
        <Button
          variant='subtle'
          onClick={() => setSelected(undefined)}
        >{t`返回入库单列表`}</Button>
        <WmsReceiptWorkbench
          key={selected ?? 'new'}
          initialReceiptId={selected}
        />
      </Stack>
    );
  return (
    <Stack>
      <Group justify='space-between'>
        <Text>{t`入库单管理`}</Text>
        <Button onClick={() => setSelected(null)}>{t`新建入库单`}</Button>
      </Group>
      <Group align='end'>
        <TextInput
          label={t`单号`}
          value={filters.number}
          onChange={(e) => change('number', e.currentTarget.value)}
        />
        <TextInput
          label={t`项目号`}
          value={filters.project}
          onChange={(e) => change('project', e.currentTarget.value)}
        />
        <TextInput
          label={t`合同号`}
          value={filters.contract}
          onChange={(e) => change('contract', e.currentTarget.value)}
        />
        <TextInput
          type='date'
          label={t`开始日期`}
          value={filters.start}
          onChange={(e) => change('start', e.currentTarget.value)}
        />
        <TextInput
          type='date'
          label={t`结束日期`}
          value={filters.end}
          onChange={(e) => change('end', e.currentTarget.value)}
        />
        <Select
          clearable
          label={t`状态`}
          value={filters.status || null}
          data={statuses}
          onChange={(v) => change('status', v ?? '')}
        />
      </Group>
      {receipts.isError && (
        <Alert color='red'>
          {t`入库单加载失败，请检查筛选条件后重试`}
          <Button
            variant='subtle'
            onClick={() => void receipts.refetch()}
          >{t`重试`}</Button>
        </Alert>
      )}
      <Table.ScrollContainer minWidth={800}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              {[
                t`单号`,
                t`项目号`,
                t`合同号`,
                t`实际库位`,
                t`创建日期`,
                t`状态`,
                t`操作`
              ].map((v) => (
                <Table.Th key={v}>{v}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(receipts.data?.results ?? []).map((r) => (
              <Table.Tr key={r.pk}>
                <Table.Td>#{r.pk}</Table.Td>
                <Table.Td>{r.project}</Table.Td>
                <Table.Td>{r.contract_number}</Table.Td>
                <Table.Td>{r.location_name}</Table.Td>
                <Table.Td>
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString('zh-CN', {
                        timeZone: 'Asia/Shanghai'
                      })
                    : '—'}
                </Table.Td>
                <Table.Td>
                  {statuses.find((v) => v.value === r.status)?.label}
                </Table.Td>
                <Table.Td>
                  <Button
                    size='xs'
                    variant='light'
                    onClick={() => setSelected(r.pk)}
                  >{t`查看与维护`}</Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!receipts.isFetching && !receipts.data?.results.length && (
        <Text c='dimmed'>{t`没有符合条件的入库单`}</Text>
      )}
      <Group>
        <Text>
          {t`共`} {receipts.data?.count ?? 0} {t`条`}
        </Text>
        <Pagination
          total={Math.max(1, Math.ceil((receipts.data?.count ?? 0) / 25))}
          value={page}
          onChange={setPage}
        />
      </Group>
    </Stack>
  );
}
