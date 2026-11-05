import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  TextInput
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, queryClient } from '../../App';
import type { WmsContract } from './WmsContractTypes';
import { wmsError, wmsUrl } from './WmsInventoryPanel';
import { WmsProjectSelect } from './WmsProjectSelect';

export function WmsContractEditor({
  opened,
  contract,
  onClose,
  onSaved,
  initialProject = ''
}: {
  initialProject?: string;
  opened: boolean;
  contract: WmsContract | null;
  onClose: () => void;
  onSaved: (contract: WmsContract) => void;
}) {
  const contracts = useQuery<{ results: WmsContract[] }>({
    queryKey: ['wms-contracts'],
    queryFn: async () => (await api.get(wmsUrl('contracts'))).data
  });
  const [editingContract, setEditingContract] = useState<WmsContract | null>(
    null
  );
  const [project, setProject] = useState('');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [number, setNumber] = useState('');
  const [date, setDate] = useState('');
  const [months, setMonths] = useState<number | string>(12);
  const [impact, setImpact] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function loadContract(value: WmsContract | null) {
    setEditingContract(value);
    setProject(value?.project ?? (value ? '' : initialProject));
    setProjectId(value?.project_id ?? null);
    setNumber(value?.number ?? '');
    setActive(value?.active !== false);
    setDate(value?.acceptance_date ?? '');
    setMonths(value?.warranty_months ?? 12);
    setImpact(null);
    setReason('');
    setError('');
  }
  useEffect(() => {
    if (opened) loadContract(contract);
  }, [opened, contract, initialProject]);
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
  const projects = useQuery<{ results: Array<{ pk: number; code: string }> }>({
    queryKey: ['wms-projects'],
    queryFn: async () =>
      (await api.get(wmsUrl('projects'), { params: { all: true } })).data
  });
  const selectedProjectId =
    projectId ??
    projects.data?.results.find((p) => p.code === project)?.pk ??
    null;
  const contractOptions = (contracts.data?.results ?? []).map((c) => ({
    value: String(c.pk),
    label: c.number
  }));
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={editingContract ? t`编辑合同与验收` : t`新建合同`}
    >
      <Stack>
        {error && <Alert color='red'>{error}</Alert>}
        <Select
          label={t`选择已有合同（留空则新建）`}
          clearable
          searchable
          value={editingContract ? String(editingContract.pk) : null}
          data={contractOptions}
          onChange={(value) =>
            loadContract(
              contracts.data?.results.find((c) => String(c.pk) === value) ??
                null
            )
          }
        />
        <TextInput
          label={t`合同号`}
          required
          maxLength={100}
          value={number}
          onChange={(e) => {
            setNumber(e.currentTarget.value);
            setImpact(null);
          }}
        />
        <WmsProjectSelect
          label={t`所属项目`}
          required={!editingContract || !!editingContract.project_id}
          value={project}
          onChange={(code, id) => {
            setProject(code);
            setProjectId(id ?? null);
            setImpact(null);
          }}
        />
        {editingContract && !editingContract.project_id && (
          <Alert color='yellow'>{t`历史合同尚未确定所属项目，请核对关联单据后补充；不会自动改写历史单据。`}</Alert>
        )}
        <TextInput
          type='date'
          label={t`验收日期（合同起始时间）`}
          description={t`可在入库后补填或更新，关联设备按此日期统一计算质保。`}
          value={date}
          onChange={(e) => {
            setDate(e.currentTarget.value);
            setImpact(null);
          }}
        />
        <Group>
          <Button
            variant='light'
            onClick={() => {
              setMonths(12);
              setImpact(null);
            }}
          >{t`12个月`}</Button>
          <Button
            variant='light'
            onClick={() => {
              setMonths(24);
              setImpact(null);
            }}
          >{t`24个月`}</Button>
        </Group>
        <NumberInput
          label={t`合同质保月数`}
          required
          min={1}
          allowDecimal={false}
          value={months}
          onChange={(value) => {
            setMonths(value);
            setImpact(null);
          }}
        />
        {editingContract && (
          <TextInput
            label={t`修改原因`}
            required
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
        )}
        <Switch
          label={t`启用合同`}
          description={t`停用后不再供新单据选择，历史单据和原标签继续有效。`}
          checked={active}
          onChange={(e) => {
            setActive(e.currentTarget.checked);
            setImpact(null);
          }}
        />
        {impact && (
          <Alert color='yellow'>
            {t`关联设备明细数`}：{impact.before.acceptance_followers} ·{' '}
            {number.trim() !== editingContract?.number
              ? t`合同号发生变化，关联标签需更换；原标签将失效。`
              : t`更新验收日期、质保月数或启用状态无需更换标签，原二维码继续有效。`}
          </Alert>
        )}
        <Button
          loading={busy}
          disabled={
            !number.trim() ||
            ((!editingContract || !!editingContract.project_id) &&
              !selectedProjectId) ||
            Number(months) < 1 ||
            (!!editingContract && !reason.trim())
          }
          onClick={() =>
            void run(async () => {
              const values = {
                pk: editingContract?.pk,
                number,
                project_id: selectedProjectId,
                active,
                acceptance_date: date || null,
                warranty_months: Number(months),
                reason,
                expected_updated_at: editingContract?.updated_at
              };
              if (editingContract && !impact) {
                setImpact(
                  (
                    await api.post(wmsUrl('contracts'), {
                      ...values,
                      preview: true
                    })
                  ).data
                );
                return;
              }
              const { data } = await api.post<WmsContract>(
                wmsUrl('contracts'),
                values
              );
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['wms-contracts'] }),
                queryClient.invalidateQueries({ queryKey: ['wms-receipts'] }),
                queryClient.invalidateQueries({
                  queryKey: ['wms-stock-detail']
                }),
                queryClient.invalidateQueries({ queryKey: ['wms-options'] }),
                queryClient.invalidateQueries({
                  queryKey: ['wms-direct-label']
                })
              ]);
              onSaved(data);
              onClose();
            })
          }
        >
          {editingContract && !impact ? t`核对影响数量` : t`确认保存合同`}
        </Button>
      </Stack>
    </Modal>
  );
}
