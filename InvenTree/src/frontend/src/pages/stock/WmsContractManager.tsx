import { t } from '@lingui/core/macro';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, queryClient } from '../../App';
import { WmsContractEditor } from './WmsContractEditor';
import type { WmsContract } from './WmsContractTypes';
import { wmsError, wmsUrl } from './WmsInventoryPanel';

export function WmsContractManager() {
  const contracts = useQuery<{ results: WmsContract[] }>({
    queryKey: ['wms-contracts'],
    queryFn: async () => (await api.get(wmsUrl('contracts'))).data
  });
  const [search, setSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [status, setStatus] = useState<string | null>('all');
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<WmsContract | null>(null);
  const [deleting, setDeleting] = useState<WmsContract | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Stack>
      {(error || contracts.isError) && (
        <Alert color='red'>{error || t`合同加载失败，请重试`}</Alert>
      )}
      <Group>
        <TextInput
          label={t`搜索合同号`}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        <TextInput
          label={t`搜索所属项目`}
          value={projectSearch}
          onChange={(e) => setProjectSearch(e.currentTarget.value)}
        />
        <Select
          label={t`状态`}
          value={status}
          onChange={setStatus}
          data={[
            { value: 'all', label: t`全部` },
            { value: 'active', label: t`启用` },
            { value: 'inactive', label: t`停用` }
          ]}
        />
        <Button
          onClick={() => {
            setEditing(null);
            setOpened(true);
          }}
        >{t`新建合同`}</Button>
      </Group>
      <Text size='sm'>{t`验收日期可在入库后统一补填；更新验收日期或质保月数无需更换标签。停用只限制新单据选用。`}</Text>
      <Table.ScrollContainer minWidth={650}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              {[
                t`合同号`,
                t`所属项目`,
                t`验收日期`,
                t`质保月数`,
                t`状态`,
                t`操作`
              ].map((v) => (
                <Table.Th key={v}>{v}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(contracts.data?.results ?? [])
              .filter(
                (c) =>
                  c.number.includes(search) &&
                  (c.project || t`待关联项目`)
                    .toLocaleLowerCase()
                    .includes(projectSearch.trim().toLocaleLowerCase()) &&
                  (status === 'all' ||
                    (status === 'active'
                      ? c.active !== false
                      : c.active === false))
              )
              .map((c) => (
                <Table.Tr key={c.pk}>
                  <Table.Td>{c.number}</Table.Td>
                  <Table.Td>{c.project || t`待关联项目`}</Table.Td>
                  <Table.Td>{c.acceptance_date || t`待验收`}</Table.Td>
                  <Table.Td>{c.warranty_months}</Table.Td>
                  <Table.Td>
                    <Badge color={c.active === false ? 'gray' : 'blue'}>
                      {c.active === false ? t`停用` : t`启用`}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group>
                      <Button
                        variant='light'
                        size='xs'
                        onClick={() => {
                          setEditing(c);
                          setOpened(true);
                        }}
                      >{t`编辑`}</Button>
                      <Button
                        variant='subtle'
                        color='red'
                        size='xs'
                        onClick={() => {
                          setError('');
                          setDeleting(c);
                        }}
                      >{t`删除`}</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <WmsContractEditor
        opened={opened}
        contract={editing}
        onClose={() => setOpened(false)}
        onSaved={() => {}}
      />
      <Modal
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={t`删除未使用合同`}
      >
        <Stack>
          <Text>{deleting?.number}</Text>
          <Text>{t`仅未被单据使用的合同可以删除；已使用的合同请停用。修改记录保留。`}</Text>
          {error && <Alert color='red'>{error}</Alert>}
          <Button
            color='red'
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(wmsUrl('contracts'), {
                  pk: deleting?.pk,
                  action: 'delete'
                });
                await queryClient.invalidateQueries({
                  queryKey: ['wms-contracts']
                });
                setDeleting(null);
              } catch (e) {
                setError(wmsError(e));
              } finally {
                setBusy(false);
              }
            }}
          >{t`确认删除`}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
