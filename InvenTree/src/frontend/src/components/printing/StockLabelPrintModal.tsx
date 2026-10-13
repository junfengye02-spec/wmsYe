import { t } from '@lingui/core/macro';
import { Alert, Button, Loader, Modal, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../contexts/ApiContext';
import { LOCAL_PRINT_URL } from '../../functions/printing/LocalPrintClient';
import { useUserState } from '../../states/UserState';
import { type LocalPrintConfig, LocalPrintModal } from './LocalPrintModal';

interface StockLabelRow {
  id: number;
  equipment: string;
  name: string;
  project: string;
  contract_number: string;
  label_kind: 'complete' | 'basic';
}

export function StockLabelPrintModal({
  items,
  config,
  onClose
}: {
  items: number[];
  config: LocalPrintConfig;
  onClose: () => void;
}) {
  const api = useApi();
  const userId = useUserState((state) => state.user?.pk);
  const labels = useQuery<StockLabelRow[]>({
    queryKey: ['stock-print-labels', userId, items],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (await api.post(`${LOCAL_PRINT_URL}stock-labels/`, { items })).data
  });
  if (!labels.data || labels.isFetching || labels.isError) {
    const data = (labels.error as any)?.response?.data;
    const message =
      typeof data === 'string'
        ? data
        : Array.isArray(data)
          ? data.join('；')
          : data?.detail
            ? String(data.detail)
            : t`无法读取所选库存的标签信息，请重试。`;
    return (
      <Modal opened title={t`本机标签打印`} onClose={onClose} size='lg'>
        <Stack>
          {labels.isError ? (
            <>
              <Alert color='red'>{message}</Alert>
              <Button onClick={() => void labels.refetch()}>{t`重试`}</Button>
            </>
          ) : (
            <>
              <Loader />
              <Text>{t`正在核对所选库存的标签信息…`}</Text>
            </>
          )}
        </Stack>
      </Modal>
    );
  }
  return (
    <LocalPrintModal
      modelType='stockitem'
      items={items}
      itemDetails={labels.data.map((row) => ({
        id: row.id,
        label: `${row.equipment} · ${row.name} · #${row.id}`,
        description:
          row.label_kind === 'complete'
            ? `${t`完整标签`} · ${t`项目`}：${row.project} · ${t`合同`}：${row.contract_number}`
            : `${t`基础设备标签（未关联合同）`} · ${t`项目`}：${row.project || t`未填写`}`,
        copies: 1
      }))}
      labelNotice={t`已关联来源明细的库存打印原完整二维码；未关联合同的库存打印基础设备码。打印数量不会改变库存。`}
      config={config}
      onClose={onClose}
    />
  );
}
