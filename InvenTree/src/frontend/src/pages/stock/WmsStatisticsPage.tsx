import { ModelType } from '@lib/enums/ModelType';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../App';
import PageTitle from '../../components/nav/PageTitle';
import { canViewStockHistory } from '../../functions/wms';
import { useUserState } from '../../states/UserState';
import { StockTrackingTable } from '../../tables/stock/StockTrackingTable';
import { ScanApprovalRequestDetails } from './ScanApprovalRequestDetails';
import { WmsBusinessAttachments } from './WmsBusinessAttachments';
import {
  type WmsOptions,
  cellText,
  chinaDay,
  wmsDownload,
  wmsError,
  wmsUrl
} from './WmsInventoryPanel';

type Filters = {
  batch: string;
  contract: string;
  search: string;
  model_number: string;
  start: string;
  end: string;
  location: string;
};
type RecordRow = {
  pk: number;
  name: string;
  IPN: string;
  brand: string;
  model_number: string;
  batch: string;
  contract_number: string;
  quantity: string;
  units: string;
  location: string;
  operator: string;
  approver: string;
  completed_at: string;
  approval_request: number | null;
  can_view_attachments?: boolean;
  reference: string;
  attachment_count: number;
  acceptance_date: string | null;
  warranty_end: string | null;
  remark: string;
  purpose: string;
};
const initialFilters = (): Filters => ({
  batch: '',
  contract: '',
  search: '',
  model_number: '',
  start: `${chinaDay().slice(0, 7)}-01`,
  end: chinaDay(),
  location: ''
});

export default function WmsStatisticsPage() {
  const user = useUserState();
  const navigate = useNavigate();
  const saved = useLocation().state as {
    tab?: string;
    draft?: Filters;
    filters?: Filters;
    page?: number;
  } | null;
  const canView = user.hasViewPermission(ModelType.stockitem);
  const [tab, setTab] = useState<string | null>(saved?.tab ?? 'INBOUND');
  const [draft, setDraft] = useState<Filters>(saved?.draft ?? initialFilters);
  const [filters, setFilters] = useState<Filters>(
    saved?.filters ?? initialFilters
  );
  const [page, setPage] = useState(saved?.page ?? 1);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [requestDetails, setRequestDetails] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const direction = tab === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND';
  const options = useQuery<WmsOptions>({
    queryKey: ['wms-options'],
    enabled: canView,
    queryFn: async ({ signal }) =>
      (await api.get(wmsUrl('options'), { signal })).data
  });
  const records = useQuery<{
    count: number;
    results: RecordRow[];
    statistics: {
      record_count: number;
      part_count: number;
      units: Record<string, string>;
    };
  }>({
    queryKey: ['wms-statistics', direction, filters, page],
    enabled: canView && tab !== 'tracking',
    queryFn: async ({ signal }) =>
      (
        await api.get(wmsUrl('records'), {
          signal,
          params: {
            ...filters,
            operation: direction,
            offset: (page - 1) * 25,
            limit: 25
          }
        })
      ).data
  });
  const field = (key: keyof Filters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const query = () => {
    if (draft.start && draft.end && draft.start > draft.end) {
      setError(t`开始日期不能晚于结束日期`);
      return;
    }
    setError('');
    setFilters({ ...draft });
    setPage(1);
    if (JSON.stringify(filters) === JSON.stringify(draft))
      void records.refetch();
  };
  const statistics = records.data?.statistics;
  return (
    <Stack gap='lg'>
      <PageTitle title={t`统计查询`} />
      <div>
        <Title order={1}>{t`统计查询`}</Title>
        <Text c='dimmed'>{t`按项目、合同和设备查询已完成的出入库记录。`}</Text>
      </div>
      {!canView ? (
        <Alert color='yellow'>{t`没有查看库存记录的权限`}</Alert>
      ) : (
        <Tabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            setPage(1);
            setSelected(null);
            setError('');
          }}
          keepMounted={false}
        >
          <Tabs.List>
            <Tabs.Tab value='INBOUND'>{t`入库记录`}</Tabs.Tab>
            <Tabs.Tab value='OUTBOUND'>{t`出库记录`}</Tabs.Tab>
            {canViewStockHistory(user.user) && (
              <Tabs.Tab value='tracking'>{t`库存流水`}</Tabs.Tab>
            )}
          </Tabs.List>
          {tab === 'tracking' && canViewStockHistory(user.user) ? (
            <Tabs.Panel value='tracking' pt='md'>
              <StockTrackingTable scope='global' />
            </Tabs.Panel>
          ) : (
            <Stack mt='md'>
              <Paper withBorder p='md' radius='sm'>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    query();
                  }}
                >
                  <Stack>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
                      <TextInput
                        label={t`项目`}
                        placeholder={t`输入项目号（含历史项目）`}
                        value={draft.batch}
                        onChange={(event) =>
                          field('batch', event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label={t`合同号`}
                        value={draft.contract}
                        onChange={(event) =>
                          field('contract', event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label={t`设备名称 / 编号`}
                        value={draft.search}
                        onChange={(event) =>
                          field('search', event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label={t`设备型号`}
                        value={draft.model_number}
                        onChange={(event) =>
                          field('model_number', event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label={t`开始日期`}
                        type='date'
                        value={draft.start}
                        onChange={(event) =>
                          field('start', event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label={t`结束日期`}
                        type='date'
                        value={draft.end}
                        onChange={(event) =>
                          field('end', event.currentTarget.value)
                        }
                      />
                      <Select
                        label={t`实际库位`}
                        searchable
                        clearable
                        data={options.data?.locations ?? []}
                        value={draft.location || null}
                        onChange={(value) => field('location', value ?? '')}
                      />
                      <Group align='end'>
                        <Button type='submit'>{t`查询`}</Button>
                        <Button
                          variant='default'
                          onClick={() => {
                            const reset = initialFilters();
                            setDraft(reset);
                            setFilters(reset);
                            setPage(1);
                            setError('');
                          }}
                        >{t`重置`}</Button>
                      </Group>
                    </SimpleGrid>
                    <Text
                      size='sm'
                      c='dimmed'
                    >{t`型号和品牌按当前基础资料展示及筛选；项目、合同和数量使用落账时的业务记录。`}</Text>
                  </Stack>
                </form>
              </Paper>
              <Alert color='blue'>{t`仅统计成功落账的扫码明细，按中国时区正式时间查询，包含结束日全天。待审批、驳回、撤销和盘点调整不计入；不同单位分别汇总。`}</Alert>
              {(error || records.isError || options.isError) && (
                <Alert color='red'>
                  {error ||
                    (records.isError
                      ? wmsError(records.error)
                      : t`筛选选项加载失败，请刷新重试`)}
                </Alert>
              )}
              <Group justify='space-between'>
                <Text>
                  {t`成功记录数`}：{statistics?.record_count ?? 0} ·{' '}
                  {t`设备种类数`}：{statistics?.part_count ?? 0} · {t`数量小计`}
                  ：
                  {Object.entries(statistics?.units ?? {})
                    .map(
                      ([unit, quantity]) =>
                        `${cellText('quantity', quantity)} ${unit}`
                    )
                    .join('；') || '—'}
                </Text>
                <Group>
                  <Button
                    variant='subtle'
                    loading={records.isFetching}
                    onClick={() => void records.refetch()}
                  >{t`刷新`}</Button>
                  <Button
                    variant='default'
                    loading={exporting}
                    onClick={async () => {
                      setExporting(true);
                      setError('');
                      try {
                        await wmsDownload('records', {
                          ...filters,
                          operation: direction,
                          export: 'csv'
                        });
                      } catch (err) {
                        setError(wmsError(err));
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >{t`导出查询结果`}</Button>
                </Group>
              </Group>
              {records.isPending ? (
                <Loader />
              ) : (
                <Table.ScrollContainer minWidth={1200}>
                  <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        {[
                          direction === 'INBOUND' ? t`入库时间` : t`出库时间`,
                          t`项目 / 合同号`,
                          t`设备名称 / 型号`,
                          t`品牌`,
                          t`数量`,
                          t`实际库位`,
                          t`申请人 / 审核人`,
                          direction === 'INBOUND'
                            ? t`到货单附件`
                            : t`出库单附件`,
                          t`操作`
                        ].map((label) => (
                          <Table.Th key={label}>{label}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {records.data?.results.map((row) => (
                        <Table.Tr key={row.pk}>
                          <Table.Td>
                            {cellText('completed_at', row.completed_at)}
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{row.batch || '—'}</Text>
                            <Text size='xs' c='dimmed'>
                              {row.contract_number || t`历史未填写`}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm'>{row.name}</Text>
                            <Text size='xs' c='dimmed'>
                              {row.model_number || '—'} · {row.IPN}
                            </Text>
                          </Table.Td>
                          <Table.Td>{row.brand || '—'}</Table.Td>
                          <Table.Td>
                            {cellText('quantity', row.quantity)} {row.units}
                          </Table.Td>
                          <Table.Td>{row.location}</Table.Td>
                          <Table.Td>
                            {row.operator || '—'} / {row.approver || '—'}
                          </Table.Td>
                          <Table.Td>
                            {row.approval_request &&
                            row.can_view_attachments !== false ? (
                              <Button
                                variant='subtle'
                                size='xs'
                                onClick={() => setSelected(row)}
                              >
                                {row.attachment_count
                                  ? t`查看附件`
                                  : t`查看 / 补充`}
                                {row.attachment_count
                                  ? ` (${row.attachment_count})`
                                  : ''}
                              </Button>
                            ) : (
                              <Text size='xs' c='dimmed'>
                                {row.approval_request
                                  ? t`无单据查看权限`
                                  : t`历史直接落账记录`}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Button
                              variant='subtle'
                              size='xs'
                              onClick={() => {
                                if (
                                  row.approval_request &&
                                  row.can_view_attachments !== false
                                ) {
                                  navigate(
                                    `/stock/statistics/batch/${row.approval_request}/`,
                                    {
                                      state: {
                                        statisticsState: {
                                          tab,
                                          draft,
                                          filters,
                                          page
                                        }
                                      }
                                    }
                                  );
                                } else setSelected(row);
                              }}
                            >{t`查看`}</Button>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {records.data?.count === 0 && (
                    <Text p='lg' c='dimmed'>{t`没有符合条件的记录`}</Text>
                  )}
                </Table.ScrollContainer>
              )}
              <Group justify='space-between'>
                <Text size='sm'>
                  {t`共`} {records.data?.count ?? 0} {t`条记录`}
                </Text>
                <Pagination
                  value={page}
                  onChange={setPage}
                  total={Math.max(
                    1,
                    Math.ceil((records.data?.count ?? 0) / 25)
                  )}
                />
              </Group>
            </Stack>
          )}
        </Tabs>
      )}
      <Modal
        opened={!!selected}
        onClose={() => {
          setSelected(null);
          setRequestDetails(false);
        }}
        title={t`单据详情`}
        size='lg'
      >
        {selected && (
          <Stack>
            <Text fw={600}>
              {selected.name} · {selected.reference || t`历史直接落账记录`}
            </Text>
            {selected.approval_request &&
              selected.can_view_attachments !== false && (
                <Button
                  variant='subtle'
                  onClick={() => setRequestDetails((value) => !value)}
                >
                  {requestDetails ? t`收起审批单` : t`查看审批单`}
                </Button>
              )}
            {requestDetails &&
              selected.approval_request &&
              selected.can_view_attachments !== false && (
                <ScanApprovalRequestDetails
                  requestId={selected.approval_request}
                />
              )}
            <Text size='sm'>
              {t`正式时间`}：{cellText('completed_at', selected.completed_at)} ·{' '}
              {t`数量`}：{cellText('quantity', selected.quantity)}{' '}
              {selected.units}
            </Text>
            <Text size='sm'>
              {t`申请人`}：{selected.operator || '—'} · {t`审核人`}：
              {selected.approver || '—'} · {t`实际库位`}：{selected.location}
            </Text>
            <Text size='sm'>
              {t`项目`}：{selected.batch || '—'} · {t`合同号`}：
              {selected.contract_number || '—'}
            </Text>
            <Text size='sm'>
              {t`验收日期`}：{selected.acceptance_date || t`待补充`} ·{' '}
              {t`质保到期日`}：{selected.warranty_end || '—'}
            </Text>
            <Text size='sm'>
              {t`备注`}：{selected.remark || '—'}
              {direction === 'OUTBOUND'
                ? ` · ${t`用途`}：${selected.purpose || '—'}`
                : ''}
            </Text>
            {selected.approval_request &&
            selected.can_view_attachments !== false ? (
              <WmsBusinessAttachments
                requestId={selected.approval_request}
                direction={direction}
              />
            ) : (
              <Text c='dimmed'>
                {selected.approval_request
                  ? t`无单据查看权限`
                  : t`该历史记录没有关联审批单，不能在此补充单据附件。`}
              </Text>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
