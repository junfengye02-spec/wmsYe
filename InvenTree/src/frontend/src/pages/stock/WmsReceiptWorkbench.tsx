import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Image,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../App';
import {
  type LocalPrintConfig,
  LocalPrintModal
} from '../../components/printing/LocalPrintModal';
import { LOCAL_PRINT_URL } from '../../functions/printing/LocalPrintClient';
import { createUuid } from '../../functions/uuid';
import { WmsContractEditor } from './WmsContractEditor';
import type {
  WmsContract,
  WmsReceipt,
  WmsReceiptDetail
} from './WmsContractTypes';
import { wmsError, wmsUrl } from './WmsInventoryPanel';
import labelStyles from './WmsLabelPreview.module.css';
import { WmsProjectSelect } from './WmsProjectSelect';
import { WmsReceiptLineEditor } from './WmsReceiptLineEditor';

function LabelPreview({ detail }: { detail: WmsReceiptDetail }) {
  const qr = useQuery({
    queryKey: ['wms-label-preview', detail.barcode],
    queryFn: () =>
      QRCode.toDataURL(detail.barcode, {
        margin: 4,
        errorCorrectionLevel: 'H',
        width: 300
      })
  });
  return (
    <Paper withBorder radius={0} className={labelStyles.label}>
      {qr.data && (
        <Image
          src={qr.data}
          className={labelStyles.qr}
          alt={t`完整二维码预览`}
        />
      )}
      <Box
        className={labelStyles.body}
        style={{ fontSize: `${(detail.label_font_size ?? 6) * 0.70556}cqw` }}
      >
        <Text className={labelStyles.name}>{detail.name}</Text>
        <Text className={labelStyles.field}>
          {t`品牌`}：{detail.brand || '—'}
        </Text>
        <Text className={labelStyles.field}>
          {t`规格`}：{detail.specification || '—'}
        </Text>
        <Text className={labelStyles.field}>
          {t`型号`}：{detail.model_number || '—'}
        </Text>
      </Box>
      <Text className={labelStyles.company}>
        广州南沙智慧城市大数据有限公司
      </Text>
    </Paper>
  );
}

export function WmsReceiptWorkbench({
  initialReceiptId = null
}: {
  initialReceiptId?: number | null;
} = {}) {
  const navigate = useNavigate();
  const receipts = useQuery<{ results: WmsReceipt[] }>({
    queryKey: ['wms-receipts', initialReceiptId],
    queryFn: async () =>
      (
        await api.get(wmsUrl('receipts'), {
          params: initialReceiptId ? { pk: initialReceiptId } : {}
        })
      ).data
  });
  const contracts = useQuery<{ results: WmsContract[] }>({
    queryKey: ['wms-contracts'],
    queryFn: async () => (await api.get(wmsUrl('contracts'))).data
  });
  const locations = useQuery<{
    results: Array<{ pk: number; pathstring: string }>;
  }>({
    queryKey: ['scan-stock-locations'],
    queryFn: async () =>
      (
        await api.get(apiUrl(ApiEndpoints.stock_location_list), {
          params: { limit: 500, structural: false }
        })
      ).data
  });
  const config = useQuery<LocalPrintConfig>({
    queryKey: ['local-print-config'],
    queryFn: async () => (await api.get(`${LOCAL_PRINT_URL}config/`)).data
  });
  const [receiptId, setReceiptId] = useState<string | null>(
    initialReceiptId ? String(initialReceiptId) : null
  );
  const receipt = receipts.data?.results.find(
    (r) => String(r.pk) === receiptId
  );
  const [project, setProject] = useState('');
  const [contractId, setContractId] = useState<string | null>(null);
  const contract = contracts.data?.results.find(
    (c) => String(c.pk) === contractId
  );
  const [location, setLocation] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [partId, setPartId] = useState<string | null>(null);
  const [confirmedLocation, setConfirmedLocation] = useState(false);
  const [splitNotice, setSplitNotice] = useState(false);
  const [historyOpened, setHistoryOpened] = useState(false);
  const history = useQuery<{
    results: Array<{
      pk: number;
      action: string;
      actor: string;
      created_at: string;
      reason: string;
    }>;
  }>({
    queryKey: ['wms-receipt-history', receiptId],
    enabled: historyOpened && !!receiptId,
    queryFn: async () =>
      (await api.get(wmsUrl('changes'), { params: { receipt: receiptId } }))
        .data
  });
  const [linesEditing, setLinesEditing] = useState(false);
  const [quantity, setQuantity] = useState<number | string>(1);
  const [lines, setLines] = useState<
    Array<{
      part: number;
      name: string;
      prepared_quantity: number | string;
    }>
  >([]);
  const [key, setKey] = useState(() => createUuid());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [printIds, setPrintIds] = useState<number[]>([]);
  const [printCopies, setPrintCopies] = useState<
    Record<number, number | string>
  >({});
  const [printing, setPrinting] = useState(false);
  const [preview, setPreview] = useState<WmsReceiptDetail | null>(null);
  const [editing, setEditing] = useState<WmsReceiptDetail | null>(null);
  const [editProject, setEditProject] = useState('');
  const [editContract, setEditContract] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState<number | string>(1);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [headerEditing, setHeaderEditing] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<WmsContract | null>(
    null
  );
  const parts = useQuery<{
    results: Array<{
      pk: number;
      IPN: string;
      name: string;
      default_location?: number | null;
    }>;
  }>({
    queryKey: ['wms-receipt-parts', search],
    queryFn: async ({ signal }) =>
      (
        await api.get(wmsUrl('parts'), {
          signal,
          params: { search, limit: 100, active: true }
        })
      ).data
  });
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(wmsError(err));
    } finally {
      setBusy(false);
    }
  }
  const chooseContract = (value: string | null) => {
    setContractId(value);
  };
  const selectedPart = parts.data?.results.find((p) => String(p.pk) === partId);
  useEffect(() => {
    const defaultId = selectedPart?.default_location;
    if (
      !location &&
      defaultId &&
      locations.data?.results.some((l) => l.pk === defaultId)
    )
      setLocation(String(defaultId));
  }, [selectedPart?.pk, selectedPart?.default_location, locations.data]);
  const locationConflict =
    !!selectedPart?.default_location &&
    !!location &&
    String(selectedPart.default_location) !== location;
  const contractOptionsFor = (projectCode: string, selectedId: string | null) =>
    (contracts.data?.results ?? [])
      .filter(
        (c) =>
          c.project === projectCode ||
          !c.project_id ||
          String(c.pk) === selectedId
      )
      .filter(
        (c) =>
          c.active !== false ||
          String(c.pk) === contractId ||
          (!!editing && String(c.pk) === editContract)
      )
      .map((c) => ({
        value: String(c.pk),
        label: c.project_id ? c.number : `${c.number} · ${t`待关联项目`}`
      }));
  const contractOptions = contractOptionsFor(project, contractId);
  function newReceipt() {
    setReceiptId(null);
    setProject('');
    setContractId(null);
    setLocation(null);
    setSearch('');
    setPartId(null);
    setQuantity(1);
    setConfirmedLocation(false);
    setSplitNotice(false);
    setLines([]);
    setPrintIds([]);
    setPrintCopies({});
    setPreview(null);
    setError('');
    setReason('');
    setKey(createUuid());
  }
  function openContract(value: WmsContract | null) {
    setEditingContract(value);
    setContractOpen(true);
  }
  return (
    <Stack>
      {(error || receipts.isError) && (
        <Alert color='red'>{error || t`入库单加载失败，请重试`}</Alert>
      )}
      <Group align='end'>
        <Select
          style={{ flex: 1 }}
          label={t`已保存的入库单`}
          placeholder={t`选择已保存的记录`}
          searchable
          clearable
          value={receiptId}
          disabled={busy}
          data={(receipts.data?.results ?? []).map((r) => ({
            value: String(r.pk),
            label: `#${r.pk} · ${r.project}${r.cancelled ? ` · ${t`已取消`}` : ''}`
          }))}
          onChange={(value) => {
            setReceiptId(value);
            setPrintIds([]);
            setPrintCopies({});
            setError('');
          }}
        />
        <Button
          type='button'
          variant='light'
          disabled={busy}
          onClick={newReceipt}
        >{t`新建入库单`}</Button>
      </Group>
      <Text size='sm' c='dimmed'>
        {t`用于新到货填单、生成标签及补打。保存不会增加库存，日常扫码请使用出入库申请页面。`}
      </Text>
      <Stack>
        {!receipt ? (
          <>
            <WmsProjectSelect
              label={t`项目号`}
              required
              value={project}
              onChange={(value) => {
                setProject(value);
                setContractId(null);
                setKey(createUuid());
              }}
            />
            <Group align='end'>
              <Select
                style={{ flex: 1 }}
                label={t`合同号`}
                searchable
                required
                value={contractId}
                data={contractOptions}
                onChange={chooseContract}
              />
              <Button
                variant='light'
                onClick={() => openContract(null)}
              >{t`新建合同`}</Button>
            </Group>
            {contract && (
              <Text size='sm'>
                {t`验收日期（合同起始时间）`}：
                {contract.acceptance_date || t`待验收`} · {t`质保月数`}：
                {contract.warranty_months}
              </Text>
            )}
            <Select
              label={t`入库库位`}
              required
              searchable
              value={location}
              data={(locations.data?.results ?? []).map((l) => ({
                value: String(l.pk),
                label: l.pathstring
              }))}
              onChange={(v) => {
                setLocation(v);
                setConfirmedLocation(false);
              }}
            />
            <TextInput
              label={t`搜索设备编号或名称`}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <Group align='end'>
              <Select
                style={{ flex: 1 }}
                label={t`选择已有设备`}
                value={partId}
                data={(parts.data?.results ?? []).map((p) => ({
                  value: String(p.pk),
                  label: `${p.IPN} · ${p.name}`
                }))}
                onChange={(v) => {
                  setPartId(v);
                  setConfirmedLocation(false);
                  setSplitNotice(false);
                  const device = parts.data?.results.find(
                    (p) => String(p.pk) === v
                  );
                  const defaultId = device?.default_location;
                  if (
                    !location &&
                    defaultId &&
                    locations.data?.results.some((l) => l.pk === defaultId)
                  )
                    setLocation(String(defaultId));
                }}
              />
              <NumberInput
                label={t`准备数量`}
                value={quantity}
                min={0.00001}
                decimalScale={5}
                onChange={setQuantity}
              />
            </Group>
            {locationConflict && (
              <Alert color='yellow'>
                {t`该设备默认库位与本单库位不同，请确认处理方式。`}
                <Group>
                  <Checkbox
                    label={t`统一使用本单库位`}
                    checked={confirmedLocation}
                    onChange={(e) =>
                      setConfirmedLocation(e.currentTarget.checked)
                    }
                  />
                  <Button
                    variant='subtle'
                    onClick={() => {
                      setPartId(null);
                      setSplitNotice(true);
                    }}
                  >{t`分开填单`}</Button>
                </Group>
              </Alert>
            )}
            {splitNotice && (
              <Alert>{t`已保留本单内容。请先保存本单，再新建入库单添加刚才的设备。`}</Alert>
            )}
            <Button
              variant='light'
              disabled={
                !partId ||
                Number(quantity) <= 0 ||
                (locationConflict && !confirmedLocation)
              }
              onClick={() => {
                const part = parts.data?.results.find(
                  (p) => String(p.pk) === partId
                );
                if (!part) return;
                setLines([
                  ...lines,
                  {
                    part: part.pk,
                    name: `${part.IPN} · ${part.name}`,
                    prepared_quantity: quantity
                  }
                ]);
                setKey(createUuid());
                setPartId(null);
              }}
            >{t`添加设备明细`}</Button>
            {lines.map((line, index) => (
              <Group key={`${line.part}-${index}`}>
                <Text>
                  {line.name} · {line.prepared_quantity}
                </Text>
                <Button
                  size='xs'
                  variant='subtle'
                  onClick={() => {
                    setLines(lines.filter((_, i) => i !== index));
                    setKey(createUuid());
                  }}
                >{t`移除`}</Button>
              </Group>
            ))}
            <Button
              loading={busy}
              disabled={
                !project.trim() || !contractId || !location || !lines.length
              }
              onClick={() =>
                void run(async () => {
                  const { data } = await api.post<WmsReceipt>(
                    wmsUrl('receipts'),
                    {
                      request_key: key,
                      project,
                      contract: Number(contractId),
                      location: Number(location),
                      details: lines.map(({ name: _name, ...line }) => line)
                    }
                  );
                  await receipts.refetch();
                  setReceiptId(String(data.pk));
                  setPrintIds(data.details.map((d) => d.pk));
                })
              }
            >{t`保存并准备打印`}</Button>
          </>
        ) : (
          <>
            <Text fw={600}>
              #{receipt.pk} · {receipt.project} ·{' '}
              {
                contracts.data?.results.find((c) => c.pk === receipt.contract)
                  ?.number
              }
            </Text>
            <Button
              variant='light'
              disabled={
                receipt.cancelled ||
                receipt.details.some((d) => d.state !== 'READY')
              }
              onClick={() => {
                setHeaderEditing(true);
                setProject(receipt.project);
                setContractId(String(receipt.contract));
                setLocation(String(receipt.location));
                setReason('');
              }}
            >{t`修改待入库公共信息`}</Button>
            <Alert>{t`标签份数与准备数量分别设置；打印和补打不会增加库存。到期日当天仍在质保期，次日过保。`}</Alert>
            <Table.ScrollContainer minWidth={800}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t`打印选择`}</Table.Th>
                    <Table.Th>{t`设备`}</Table.Th>
                    <Table.Th>{t`打印数量`}</Table.Th>
                    <Table.Th>{t`项目 / 合同`}</Table.Th>
                    <Table.Th>{t`单次准备 / 累计入库`}</Table.Th>
                    <Table.Th>{t`验收 / 质保 / 到期`}</Table.Th>
                    <Table.Th>{t`状态`}</Table.Th>
                    <Table.Th>{t`操作`}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {receipt.details.map((detail) => (
                    <Table.Tr key={detail.pk}>
                      <Table.Td>
                        <Checkbox
                          aria-label={t`选择打印明细`}
                          checked={printIds.includes(detail.pk)}
                          disabled={receipt.cancelled}
                          onChange={(e) =>
                            setPrintIds(
                              e.currentTarget.checked
                                ? [...printIds, detail.pk]
                                : printIds.filter((id) => id !== detail.pk)
                            )
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        {detail.equipment}
                        <Text size='xs'>{detail.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <NumberInput
                          aria-label={`${t`打印数量`} · ${detail.equipment}`}
                          w={90}
                          min={1}
                          max={config.data?.max_labels ?? 500}
                          allowDecimal={false}
                          disabled={receipt.cancelled}
                          value={printCopies[detail.pk] ?? 1}
                          onChange={(value) =>
                            setPrintCopies((current) => ({
                              ...current,
                              [detail.pk]: value
                            }))
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        {detail.project}
                        <Text size='xs'>{detail.contract_number}</Text>
                      </Table.Td>
                      <Table.Td>
                        {detail.prepared_quantity} /{' '}
                        {detail.received_quantity ??
                          detail.actual_quantity ??
                          '—'}
                        {Number(detail.pending_quantity) > 0 && (
                          <Text size='xs'>
                            {t`待入库数量`}：{detail.pending_quantity}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {detail.acceptance_date || t`待验收`}
                        <Text size='xs'>
                          {detail.warranty_months} {t`个月`} ·{' '}
                          {detail.warranty_end || '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge>
                          {detail.state === 'READY'
                            ? t`待核对`
                            : detail.state === 'IN_REQUEST'
                              ? t`已核对 / 申请中`
                              : detail.state === 'RECEIVED'
                                ? t`已入库`
                                : t`已取消`}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap='xs'>
                          <Button
                            size='xs'
                            variant='light'
                            onClick={() => setPreview(detail)}
                          >{t`标签预览`}</Button>
                          <Button
                            size='xs'
                            variant='light'
                            disabled={receipt.cancelled}
                            onClick={() => {
                              setEditing(detail);
                              setEditProject(detail.project);
                              setEditContract(String(detail.contract));
                              setEditQuantity(Number(detail.prepared_quantity));
                              setReason('');
                            }}
                          >{t`修改`}</Button>
                          <Button
                            size='xs'
                            disabled={
                              receipt.cancelled || !config.data?.enabled
                            }
                            onClick={() => {
                              setPrintIds([detail.pk]);
                              setPrinting(true);
                            }}
                          >{t`补打`}</Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group>
              <Button
                variant='subtle'
                onClick={() => setHistoryOpened(true)}
              >{t`修改记录`}</Button>
              <Button
                variant='light'
                disabled={
                  receipt.cancelled ||
                  receipt.details.some((d) => d.state !== 'READY')
                }
                onClick={() => setLinesEditing(true)}
              >{t`增删设备明细`}</Button>
              <Button
                disabled={
                  receipt.cancelled || !printIds.length || !config.data?.enabled
                }
                onClick={() => setPrinting(true)}
              >{t`打印所选完整标签`}</Button>
              <Button
                variant='light'
                disabled={receipt.cancelled}
                onClick={() => navigate('/stock/scan/inbound/')}
              >{t`转到实物扫码核对`}</Button>
              <Button
                variant='subtle'
                color='red'
                disabled={receipt.cancelled}
                onClick={() => {
                  setCancelling(true);
                  setReason('');
                }}
              >{t`取消待入库记录`}</Button>
            </Group>
            {!config.data?.enabled && (
              <Alert color='yellow'>{t`本地打印尚未启用，请管理员配置打印服务后重试。`}</Alert>
            )}
          </>
        )}
      </Stack>
      {printing && config.data && (
        <LocalPrintModal
          items={printIds}
          itemDetails={receipt?.details
            .filter((detail) => printIds.includes(detail.pk))
            .map((detail) => ({
              id: detail.pk,
              label: `${detail.equipment} · ${detail.name}`,
              copies: printCopies[detail.pk] ?? 1
            }))}
          modelType='wmsreceiptdetail'
          config={config.data}
          onClose={() => setPrinting(false)}
        />
      )}
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={t`完整标签预览`}
      >
        {preview && <LabelPreview detail={preview} />}
      </Modal>
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={t`修改当前明细`}
      >
        <Stack>
          {error && <Alert color='red'>{error}</Alert>}
          <Alert>{t`修改项目或合同后须更换标签。验收日期即合同起始时间，在合同中统一维护。存在有效申请或库存占用时不能修改归属。`}</Alert>
          <WmsProjectSelect
            label={t`项目号`}
            value={editProject}
            onChange={(value) => {
              setEditProject(value);
              setEditContract(null);
            }}
          />
          <Select
            label={t`合同`}
            value={editContract}
            data={contractOptionsFor(editProject, editContract)}
            onChange={setEditContract}
          />
          <NumberInput
            label={t`准备数量`}
            disabled={editing?.state === 'RECEIVED'}
            min={0.00001}
            value={editQuantity}
            onChange={setEditQuantity}
          />
          <TextInput
            label={t`修改原因`}
            required
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            loading={busy}
            disabled={!reason.trim() || !editProject.trim() || !editContract}
            onClick={() =>
              void run(async () => {
                if (!editing) return;
                await api.post(wmsUrl(`details/${editing.pk}`), {
                  project: editProject,
                  contract: Number(editContract),
                  ...(editing.state === 'RECEIVED'
                    ? {}
                    : { prepared_quantity: editQuantity }),
                  reason,
                  label_version: editing.label_version
                });
                setEditing(null);
                await receipts.refetch();
              })
            }
          >{t`保存修改`}</Button>
        </Stack>
      </Modal>
      <Modal
        opened={headerEditing}
        onClose={() => setHeaderEditing(false)}
        title={t`修改待入库公共信息`}
      >
        <Stack>
          {error && <Alert color='red'>{error}</Alert>}
          <Alert>{t`仅改变项目或关联合同时需要更换标签；修改实际库位不改变二维码。`}</Alert>
          <WmsProjectSelect
            label={t`项目号`}
            value={project}
            onChange={(value) => {
              setProject(value);
              setContractId(null);
            }}
          />
          <Select
            label={t`合同号`}
            data={contractOptions}
            value={contractId}
            onChange={setContractId}
          />
          <Select
            label={t`入库库位`}
            value={location}
            data={(locations.data?.results ?? []).map((l) => ({
              value: String(l.pk),
              label: l.pathstring
            }))}
            onChange={setLocation}
          />
          <TextInput
            label={t`修改原因`}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            loading={busy}
            disabled={
              !project.trim() || !contractId || !location || !reason.trim()
            }
            onClick={() =>
              void run(async () => {
                if (!receipt) return;
                await api.post(wmsUrl(`receipts/${receipt.pk}`), {
                  project,
                  contract: Number(contractId),
                  location: Number(location),
                  expected_updated_at: receipt.updated_at,
                  reason
                });
                setHeaderEditing(false);
                setPrintIds([]);
                await receipts.refetch();
              })
            }
          >{t`保存公共信息`}</Button>
        </Stack>
      </Modal>
      <Modal
        opened={cancelling}
        onClose={() => setCancelling(false)}
        title={t`取消待入库记录`}
      >
        <Stack>
          <TextInput
            label={t`取消原因`}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            color='red'
            disabled={!reason.trim()}
            loading={busy}
            onClick={() =>
              void run(async () => {
                if (!receipt) return;
                await api.post(wmsUrl(`receipts/${receipt.pk}/cancel`), {
                  reason
                });
                setCancelling(false);
                await receipts.refetch();
              })
            }
          >{t`确认取消`}</Button>
        </Stack>
      </Modal>
      <Modal
        opened={historyOpened}
        onClose={() => setHistoryOpened(false)}
        title={t`修改记录`}
        size='lg'
      >
        <Stack>
          {history.isError && <Alert color='red'>{t`记录加载失败`}</Alert>}
          <Table>
            <Table.Thead>
              <Table.Tr>
                {[t`时间`, t`操作人`, t`操作`, t`原因`].map((v) => (
                  <Table.Th key={v}>{v}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(history.data?.results ?? []).map((h) => (
                <Table.Tr key={h.pk}>
                  <Table.Td>
                    {new Date(h.created_at).toLocaleString('zh-CN', {
                      timeZone: 'Asia/Shanghai'
                    })}
                  </Table.Td>
                  <Table.Td>{h.actor}</Table.Td>
                  <Table.Td>
                    {{
                      receipt_create: t`新建入库单`,
                      receipt_update: t`修改公共信息`,
                      receipt_lines_update: t`修改设备明细`,
                      receipt_cancel: t`作废入库单`,
                      detail_update: t`修改明细`
                    }[h.action] ?? t`其他操作`}
                  </Table.Td>
                  <Table.Td>{h.reason || '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Modal>
      <Modal
        opened={linesEditing}
        onClose={() => setLinesEditing(false)}
        title={t`增删设备明细`}
        size='xl'
      >
        {linesEditing && receipt && (
          <WmsReceiptLineEditor
            receipt={receipt}
            onSaved={() => {
              setLinesEditing(false);
              setPrintIds([]);
              void receipts.refetch();
            }}
          />
        )}
      </Modal>
      <WmsContractEditor
        opened={contractOpen}
        initialProject={project}
        contract={editingContract}
        onClose={() => setContractOpen(false)}
        onSaved={(value) => setContractId(String(value.pk))}
      />
    </Stack>
  );
}
