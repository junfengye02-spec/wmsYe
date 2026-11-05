import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  FileButton,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../App';
import { wmsError } from './WmsInventoryPanel';

type Attachment = {
  pk: number;
  name: string;
  size: number;
  uploaded_at: string;
  uploaded_by: string;
  note: string;
};

export function WmsBusinessAttachments({
  requestId,
  direction,
  compact = false
}: {
  compact?: boolean;
  requestId: number;
  direction: 'INBOUND' | 'OUTBOUND';
}) {
  const queryClient = useQueryClient();
  const url = `${apiUrl(ApiEndpoints.stock_scan_request_detail, undefined, { id: requestId })}attachments/`;
  const files = useQuery<{ results: Attachment[]; can_upload: boolean }>({
    queryKey: ['wms-business-attachments', requestId],
    queryFn: async ({ signal }) => (await api.get(url, { signal })).data
  });
  const [uploadOpened, setUploadOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(
    null
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview]
  );
  async function upload(file: File | null) {
    if (!file || busy) return;
    setError('');
    if (
      file.size > 10 * 1024 * 1024 ||
      !/\.(pdf|png|jpe?g)$/i.test(file.name)
    ) {
      setError(t`仅支持 PDF、PNG、JPG 文件，单个附件不能超过 10 MB。`);
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    form.append('note', note);
    try {
      await api.post(url, form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setNote('');
      setUploadOpened(false);
      await Promise.all([
        files.refetch(),
        queryClient.invalidateQueries({ queryKey: ['wms-statistics'] })
      ]);
    } catch (err) {
      setError(wmsError(err));
    } finally {
      setBusy(false);
    }
  }
  async function open(file: Attachment, inline: boolean) {
    setError('');
    try {
      const response = await api.get(`${url}${file.pk}/download/`, {
        responseType: 'blob'
      });
      const objectUrl = URL.createObjectURL(response.data);
      if (
        inline &&
        /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(
          response.data.type
        )
      ) {
        setPreview({ url: objectUrl, name: file.name });
      } else {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (err) {
      setError(wmsError(err));
    }
  }
  return (
    <Stack gap='xs'>
      <Group justify='space-between'>
        <Text fw={600}>
          {direction === 'INBOUND' ? t`到货单附件` : t`出库单附件`}
          {compact && (
            <Text span size='xs' c='dimmed'>
              {' '}
              · {t`选填，可在出入库后补充`}
            </Text>
          )}
        </Text>
        {compact && files.data?.can_upload && !uploadOpened && (
          <Button
            size='xs'
            variant='subtle'
            onClick={() => setUploadOpened(true)}
          >{t`上传附件`}</Button>
        )}
      </Group>
      {!compact && (
        <Text
          size='sm'
          c='dimmed'
        >{t`附件选填，可在出入库完成后补充，不影响审批和库存。`}</Text>
      )}
      {(error || files.isError) && (
        <Alert color='red'>
          {error || t`附件加载失败，请重试`}
          <Button
            size='xs'
            variant='subtle'
            onClick={() => void files.refetch()}
          >{t`重试`}</Button>
        </Alert>
      )}
      {files.isPending && <Loader size='sm' />}
      {files.data?.results.map((file) => (
        <Group key={file.pk} justify='space-between'>
          <Stack gap={0}>
            <Text size='sm'>{file.name}</Text>
            <Text size='xs' c='dimmed'>
              {file.uploaded_by} ·{' '}
              {new Date(file.uploaded_at).toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai'
              })}
              {file.note ? ` · ${file.note}` : ''}
            </Text>
          </Stack>
          <Group gap='xs'>
            <Button
              size='xs'
              variant='subtle'
              onClick={() => void open(file, true)}
            >{t`预览`}</Button>
            <Button
              size='xs'
              variant='subtle'
              onClick={() => void open(file, false)}
            >{t`下载`}</Button>
          </Group>
        </Group>
      ))}
      {!compact && files.data?.results.length === 0 && (
        <Text size='sm' c='dimmed'>{t`暂未上传附件，可稍后补充。`}</Text>
      )}
      {files.data?.can_upload && (!compact || uploadOpened) && (
        <Group align='end'>
          <TextInput
            label={t`附件说明（选填）`}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <Text
            size='xs'
            c='dimmed'
          >{t`PDF / PNG / JPG，单个文件不超过 10 MB`}</Text>
          <FileButton
            onChange={(file) => void upload(file)}
            accept='.pdf,.png,.jpg,.jpeg'
          >
            {(props) => (
              <Button
                {...props}
                variant='light'
                loading={busy}
              >{t`上传附件`}</Button>
            )}
          </FileButton>
        </Group>
      )}
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name}
        size='xl'
      >
        {preview && (
          <iframe
            sandbox=''
            title={preview.name}
            src={preview.url}
            style={{ width: '100%', height: '65vh', border: 0 }}
          />
        )}
      </Modal>
    </Stack>
  );
}
