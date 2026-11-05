import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  TextInput
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../App';
import type { WmsReceipt } from './WmsContractTypes';
import { wmsError, wmsUrl } from './WmsInventoryPanel';

export function WmsReceiptLineEditor({
  receipt,
  onSaved
}: {
  receipt: WmsReceipt;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState(
    receipt.details.map((d) => ({
      pk: d.pk as number | undefined,
      part: d.part,
      name: `${d.equipment} · ${d.name}`,
      prepared_quantity: Number(d.prepared_quantity)
    }))
  );
  const [search, setSearch] = useState('');
  const [partId, setPartId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | string>(1);
  const [confirmedLocation, setConfirmedLocation] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parts = useQuery<{
    results: Array<{
      pk: number;
      IPN: string;
      name: string;
      default_location?: number | null;
    }>;
  }>({
    queryKey: ['wms-receipt-parts', search],
    queryFn: async () =>
      (
        await api.get(wmsUrl('parts'), {
          params: { search, active: true, limit: 100 }
        })
      ).data
  });
  const part = parts.data?.results.find((p) => String(p.pk) === partId);
  const conflict =
    part?.default_location && part.default_location !== receipt.location;
  return (
    <Stack>
      <Alert>{t`仅尚未使用的入库单可增删明细。移除设备后，其原标签失效；新增设备需打印新标签。修改数量不改变库存。`}</Alert>
      {error && <Alert color='red'>{error}</Alert>}
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t`设备`}</Table.Th>
            <Table.Th>{t`准备数量`}</Table.Th>
            <Table.Th>{t`操作`}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((line, i) => (
            <Table.Tr key={line.pk ?? `new-${i}`}>
              <Table.Td>{line.name}</Table.Td>
              <Table.Td>
                <NumberInput
                  aria-label={`${t`准备数量`} · ${line.name}`}
                  min={0.00001}
                  decimalScale={5}
                  value={line.prepared_quantity}
                  onChange={(v) =>
                    setLines(
                      lines.map((l, j) =>
                        j === i ? { ...l, prepared_quantity: Number(v) } : l
                      )
                    )
                  }
                />
              </Table.Td>
              <Table.Td>
                <Button
                  variant='subtle'
                  color='red'
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >{t`移除`}</Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <TextInput
        label={t`搜索设备编号或名称`}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Group align='end'>
        <Select
          label={t`选择已有设备`}
          value={partId}
          data={(parts.data?.results ?? []).map((p) => ({
            value: String(p.pk),
            label: `${p.IPN} · ${p.name}`
          }))}
          onChange={(v) => {
            setPartId(v);
            setConfirmedLocation(false);
          }}
        />
        <NumberInput
          label={t`新增准备数量`}
          min={0.00001}
          decimalScale={5}
          value={quantity}
          onChange={setQuantity}
        />
        <Button
          disabled={
            !part || Number(quantity) <= 0 || (!!conflict && !confirmedLocation)
          }
          onClick={() => {
            if (part)
              setLines([
                ...lines,
                {
                  pk: undefined,
                  part: part.pk,
                  name: `${part.IPN} · ${part.name}`,
                  prepared_quantity: Number(quantity)
                }
              ]);
            setPartId(null);
          }}
        >{t`添加设备明细`}</Button>
      </Group>
      {!!conflict && (
        <Alert color='yellow'>
          {t`该设备默认库位与本单不同；如需使用其默认库位，请另建入库单。`}
          <Checkbox
            label={t`统一使用本单库位`}
            checked={confirmedLocation}
            onChange={(e) => setConfirmedLocation(e.currentTarget.checked)}
          />
        </Alert>
      )}
      <TextInput
        label={t`修改原因`}
        required
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
      />
      <Button
        loading={busy}
        disabled={
          !lines.length ||
          lines.some((l) => l.prepared_quantity <= 0) ||
          !reason.trim()
        }
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api.post(wmsUrl(`receipts/${receipt.pk}/lines`), {
              details: lines.map(({ name, ...line }) => line),
              reason,
              expected_updated_at: receipt.updated_at
            });
            onSaved();
          } catch (e) {
            setError(wmsError(e));
          } finally {
            setBusy(false);
          }
        }}
      >{t`保存设备明细`}</Button>
    </Stack>
  );
}
