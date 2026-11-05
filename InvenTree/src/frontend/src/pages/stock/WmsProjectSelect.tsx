import { t } from '@lingui/core/macro';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../App';
import { wmsError, wmsUrl } from './WmsInventoryPanel';

export type WmsProject = {
  pk: number;
  code: string;
  description: string;
  active: boolean;
};

function useProjects() {
  return useQuery<{ results: WmsProject[] }>({
    queryKey: ['wms-projects'],
    queryFn: async () =>
      (await api.get(wmsUrl('projects'), { params: { all: true } })).data
  });
}

export function WmsProjectSelect({
  value,
  onChange,
  label = t`项目号`,
  required = true
}: {
  value: string;
  onChange: (code: string, projectId?: number) => void;
  label?: string;
  required?: boolean;
}) {
  const projects = useProjects();
  const queryClient = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function createProject() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post<WmsProject>(wmsUrl('projects'), {
        code: code.trim(),
        description: description.trim()
      });
      const project = response.data;
      queryClient.setQueryData<{ results: WmsProject[] }>(
        ['wms-projects'],
        (current) => ({
          results: [
            ...(current?.results ?? []).filter(
              (item) => item.pk !== project.pk
            ),
            project
          ].sort((a, b) => a.code.localeCompare(b.code))
        })
      );
      onChange(project.code, project.pk);
      setOpened(false);
    } catch (err) {
      const codeErrors = (err as any)?.response?.data?.code;
      setError(
        Array.isArray(codeErrors) &&
          codeErrors.every((item) => typeof item === 'string')
          ? codeErrors.join('；')
          : wmsError(err)
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group align='end' wrap='nowrap'>
        <Select
          style={{ flex: 1 }}
          required={required}
          searchable
          clearable
          label={label}
          placeholder={t`选择已有项目，没有对应项目时先新建`}
          value={value || null}
          data={(projects.data?.results ?? [])
            .filter((item) => item.active || item.code === value)
            .map((item) => ({
              value: item.code,
              label: item.code
            }))}
          onChange={(next) =>
            onChange(
              next ?? '',
              projects.data?.results.find((item) => item.code === next)?.pk
            )
          }
          error={projects.isError ? t`项目加载失败，请重新打开页面` : undefined}
        />
        <Button
          variant='light'
          onClick={() => {
            setCode('');
            setDescription('');
            setError('');
            setOpened(true);
          }}
        >{t`新建项目`}</Button>
      </Group>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={t`新建项目`}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void createProject();
          }}
        >
          <Stack>
            {error && <Alert color='red'>{error}</Alert>}
            <Text size='sm'>{t`项目号唯一；同一项目可被多张入库单和库存记录重复引用。`}</Text>
            <TextInput
              required
              label={t`项目号`}
              maxLength={100}
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <TextInput
              label={t`项目说明`}
              maxLength={200}
              value={description}
              onChange={(event) => setDescription(event.currentTarget.value)}
            />
            <Button
              type='submit'
              loading={busy}
              disabled={!code.trim()}
            >{t`保存项目`}</Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

export function WmsProjectManager() {
  const projects = useProjects();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WmsProject | null>(null);
  const [deleting, setDeleting] = useState<WmsProject | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(remove = false) {
    setBusy(true);
    setError('');
    try {
      await api.post(
        wmsUrl('projects'),
        remove ? { pk: deleting?.pk, action: 'delete' } : editing
      );
      await queryClient.invalidateQueries({ queryKey: ['wms-projects'] });
      setEditing(null);
      setDeleting(null);
    } catch (e) {
      setError(wmsError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack>
      <Text size='sm'>{t`项目号统一管理；已被使用的项目号不能改名或删除，可以修改说明或停用。`}</Text>
      {projects.isError && <Alert color='red'>{t`项目加载失败，请重试`}</Alert>}
      <WmsProjectSelect
        value={selected}
        onChange={setSelected}
        required={false}
      />
      <TextInput
        label={t`搜索项目号或说明`}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Table>
        <Table.Thead>
          <Table.Tr>
            {[t`项目号`, t`项目说明`, t`状态`, t`操作`].map((v) => (
              <Table.Th key={v}>{v}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(projects.data?.results ?? [])
            .filter(
              (item) =>
                (!selected || item.code === selected) &&
                (item.code.includes(search) ||
                  item.description.includes(search))
            )
            .map((item) => (
              <Table.Tr key={item.pk}>
                <Table.Td>{item.code}</Table.Td>
                <Table.Td>{item.description || '—'}</Table.Td>
                <Table.Td>
                  <Badge color={item.active ? 'blue' : 'gray'}>
                    {item.active ? t`启用` : t`停用`}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group>
                    <Button
                      variant='light'
                      size='xs'
                      onClick={() => {
                        setError('');
                        setEditing({ ...item });
                      }}
                    >{t`编辑`}</Button>
                    <Button
                      color='red'
                      variant='subtle'
                      size='xs'
                      onClick={() => {
                        setError('');
                        setDeleting(item);
                      }}
                    >{t`删除`}</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      <Modal
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={t`编辑项目`}
      >
        <Stack>
          {error && <Alert color='red'>{error}</Alert>}
          <TextInput
            required
            label={t`项目号`}
            value={editing?.code ?? ''}
            onChange={(e) =>
              editing && setEditing({ ...editing, code: e.currentTarget.value })
            }
          />
          <TextInput
            label={t`项目说明`}
            value={editing?.description ?? ''}
            onChange={(e) =>
              editing &&
              setEditing({ ...editing, description: e.currentTarget.value })
            }
          />
          <Switch
            label={t`启用项目`}
            checked={editing?.active ?? true}
            onChange={(e) =>
              editing &&
              setEditing({ ...editing, active: e.currentTarget.checked })
            }
          />
          <Button
            loading={busy}
            disabled={!editing?.code.trim()}
            onClick={() => void save()}
          >{t`保存修改`}</Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!deleting}
        onClose={() => setDeleting(null)}
        title={t`删除未使用项目`}
      >
        <Stack>
          <Text>{deleting?.code}</Text>
          <Text>{t`仅未被单据或库存引用的项目可以删除，已使用的项目请停用。`}</Text>
          {error && <Alert color='red'>{error}</Alert>}
          <Button
            color='red'
            loading={busy}
            onClick={() => void save(true)}
          >{t`确认删除`}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
