import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../App';
import type { ScanMode } from './ScanStockTypes';
import type { WmsReceiptDetail } from './WmsContractTypes';
import { wmsError, wmsUrl } from './WmsInventoryPanel';

/** Search prepared sources without losing their project and contract attribution. */
export function ScanManualPicker({
  mode,
  location,
  processing,
  onSelect,
  onPrepare
}: {
  mode: ScanMode;
  location: string | null;
  processing: boolean;
  onSelect: (detail: WmsReceiptDetail, quantity: number | string) => void;
  onPrepare: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WmsReceiptDetail | null>(null);
  const [quantity, setQuantity] = useState<number | string>(1);
  const [stableSearch] = useDebouncedValue(search.trim(), 200);
  const candidates = useQuery<{
    results: WmsReceiptDetail[];
    has_more?: boolean;
  }>({
    queryKey: ['wms-scan-candidates', mode, location, stableSearch],
    queryFn: async ({ signal }) =>
      (
        await api.get(wmsUrl('scan-candidates'), {
          signal,
          params: {
            search: stableSearch,
            operation: mode.toUpperCase(),
            location: location || undefined
          }
        })
      ).data
  });
  const optionLabel = (detail: WmsReceiptDetail) =>
    `${detail.name} · ${detail.model_number || detail.equipment} · ${detail.project} / ${detail.contract_number || '—'} · #${detail.pk}`;
  const choices = [...(candidates.data?.results ?? [])];
  if (selected && !choices.some((item) => item.pk === selected.pk))
    choices.unshift(selected);
  return (
    <Stack gap='xs'>
      <Group align='flex-end' gap='sm'>
        <Select
          style={{ flex: 1, minWidth: 260 }}
          label={t`设备名称 / 型号`}
          placeholder={t`输入名称、型号或设备编号`}
          searchable
          clearable
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            if (selected && value !== optionLabel(selected)) setSelected(null);
          }}
          value={selected ? String(selected.pk) : null}
          filter={({ options }) => options}
          maxDropdownHeight={180}
          nothingFoundMessage={
            candidates.isFetching ? t`正在查找设备…` : t`没有匹配的可用明细`
          }
          data={choices.map((detail) => ({
            value: String(detail.pk),
            label: optionLabel(detail)
          }))}
          onChange={(value) => {
            const detail =
              choices.find((item) => String(item.pk) === value) ?? null;
            setSelected(detail);
            if (detail)
              setQuantity(
                mode === 'inbound'
                  ? Number(detail.prepared_quantity)
                  : (detail.stock ?? [])
                      .filter(
                        (item) =>
                          !location || item.location === Number(location)
                      )
                      .reduce(
                        (total, item) => total + Number(item.available),
                        0
                      )
              );
          }}
        />
        <NumberInput
          label={t`数量`}
          value={quantity}
          onChange={setQuantity}
          min={0.00001}
          decimalScale={5}
          w={120}
        />
        <Button
          loading={processing}
          disabled={!selected || !(Number(quantity) > 0)}
          onClick={() => {
            if (selected) {
              onSelect(selected, quantity);
              setSelected(null);
              setSearch('');
            }
          }}
        >
          {mode === 'inbound' ? t`加入待入库` : t`加入待出库`}
        </Button>
      </Group>
      {candidates.isError && (
        <Alert color='red'>{wmsError(candidates.error)}</Alert>
      )}
      {candidates.data?.has_more && (
        <Text
          size='xs'
          c='dimmed'
        >{t`匹配明细较多，请输入更具体的名称或型号。`}</Text>
      )}
      {mode === 'inbound' && (
        <Button
          variant='subtle'
          size='compact-xs'
          style={{ alignSelf: 'flex-start' }}
          onClick={onPrepare}
        >{t`没有准备明细？新建入库单`}</Button>
      )}
    </Stack>
  );
}
