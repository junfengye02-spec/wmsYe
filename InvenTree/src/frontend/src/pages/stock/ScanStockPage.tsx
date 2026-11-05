import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { ModelType } from '@lib/enums/ModelType';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Tabs,
  Text,
  Title
} from '@mantine/core';
import {
  IconArrowDown,
  IconArrowUp,
  IconChecks,
  IconHistory,
  IconQrcode,
  IconUser
} from '@tabler/icons-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, queryClient } from '../../App';
import PageTitle from '../../components/nav/PageTitle';
import { wmsAccess } from '../../functions/wms';
import { useGlobalSettingsState } from '../../states/SettingsStates';
import { useUserState } from '../../states/UserState';
import { ScanApprovalRequestListPanel } from './ScanApprovalRequestList';
import type {
  ScanMode,
  ScanStockApprovalRequest,
  ScanStockResponse
} from './ScanStockTypes';
import { ScanWorkPanel } from './ScanWorkPanel';

export default function ScanStockPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUserState();
  const globalSettings = useGlobalSettingsState();
  const approvalEnabled = globalSettings.isSet('SCAN_APPROVAL_ENABLED');
  const { canApprove } = wmsAccess(user.user, approvalEnabled);
  const mode: ScanMode = location.pathname.includes('/outbound')
    ? 'outbound'
    : 'inbound';
  const [focusRequest, setFocusRequest] = useState(0);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [nextMode, setNextMode] = useState<ScanMode | null>(null);
  const [currentDraft, setCurrentDraft] =
    useState<ScanStockApprovalRequest | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const canViewStock = user.hasViewPermission(ModelType.stockitem);
  const canScanStock =
    canViewStock && user.hasChangePermission(ModelType.stockitem);
  const switchMode = (target: ScanMode) => {
    if (target !== mode && currentDraft) {
      setNextMode(target);
      return;
    }
    setActiveTab('work');
    if (target !== mode) navigate(`/stock/scan/${target}/`);
    setFocusRequest((value) => value + 1);
  };

  const confirmModeSwitch = () => {
    if (!nextMode) return;
    setActiveTab('work');
    navigate(`/stock/scan/${nextMode}/`);
    setNextMode(null);
  };

  const cancelAndSwitchMode = async () => {
    if (!approvalEnabled || !currentDraft) {
      confirmModeSwitch();
      return;
    }
    setSwitching(true);
    setSwitchError(null);
    try {
      await api.post(
        apiUrl(ApiEndpoints.stock_scan_request_cancel, undefined, {
          id: currentDraft.pk
        }),
        { note: t`Scan direction changed by requester.` }
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['scan-stock-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['scan-stock-active-draft'] })
      ]);
      setCurrentDraft(null);
      confirmModeSwitch();
    } catch (error: any) {
      const data: Partial<ScanStockResponse> =
        error?.response?.data ?? error?.data ?? {};
      setSwitchError(
        data.error_message || t`The current request could not be cancelled.`
      );
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Stack gap='sm' data-testid='scan-workbench'>
      <PageTitle
        title={
          mode === 'inbound' ? t`Scan stock inbound` : t`Scan stock outbound`
        }
      />

      <Group justify='space-between' align='flex-start'>
        <div>
          <Title order={2}>{t`Scan stock`}</Title>
          <Text c='dimmed' size='sm'>
            {t`扫码核对设备，提交整单审批；收发记录请前往统计查询。`}
          </Text>
        </div>
        <Group gap='xs'>
          <Button
            color='blue'
            disabled={!canScanStock}
            variant={mode === 'inbound' ? 'filled' : 'light'}
            leftSection={<IconArrowDown size={18} />}
            onClick={() => switchMode('inbound')}
          >
            {t`Inbound`}
          </Button>
          <Button
            color='orange'
            disabled={!canScanStock}
            variant={mode === 'outbound' ? 'filled' : 'light'}
            leftSection={<IconArrowUp size={18} />}
            onClick={() => switchMode('outbound')}
          >
            {t`Outbound`}
          </Button>
        </Group>
      </Group>

      {!canScanStock && !canApprove && (
        <Alert>
          {t`出入库作业需要操作权限。`}{' '}
          {canViewStock && (
            <Button
              variant='subtle'
              onClick={() => navigate('/stock/statistics/')}
            >{t`前往统计查询`}</Button>
          )}
        </Alert>
      )}
      <Tabs
        value={
          activeTab ??
          (canApprove &&
          (!canScanStock ||
            new URLSearchParams(location.search).get('tab') === 'approval')
            ? 'approval'
            : canScanStock
              ? 'work'
              : canViewStock
                ? 'mine'
                : approvalEnabled
                  ? 'approval'
                  : undefined)
        }
        onChange={(value) => {
          setActiveTab(value);
          if (value === 'work') setFocusRequest((n) => n + 1);
        }}
        keepMounted={false}
      >
        <Tabs.List>
          {canScanStock && (
            <Tabs.Tab value='work' leftSection={<IconQrcode size={16} />}>
              {t`Scan work`}
            </Tabs.Tab>
          )}
          {approvalEnabled && canScanStock && (
            <Tabs.Tab value='mine' leftSection={<IconUser size={16} />}>
              {t`My requests`}
            </Tabs.Tab>
          )}
          {canApprove && (
            <Tabs.Tab value='approval' leftSection={<IconChecks size={16} />}>
              {t`Pending my approval`}
            </Tabs.Tab>
          )}
          {canApprove && (
            <Tabs.Tab
              value='approval-history'
              leftSection={<IconHistory size={16} />}
            >
              {t`审批记录`}
            </Tabs.Tab>
          )}
        </Tabs.List>

        {canScanStock && (
          <Tabs.Panel value='work' pt='sm'>
            {approvalEnabled ? (
              <ScanWorkPanel
                key={mode}
                focusRequest={focusRequest}
                mode={mode}
                onDraftChange={setCurrentDraft}
              />
            ) : (
              <Alert color='yellow'>{t`请管理员启用扫码审批后使用完整标签业务。`}</Alert>
            )}
          </Tabs.Panel>
        )}

        {approvalEnabled && canScanStock && (
          <Tabs.Panel value='mine' pt='lg'>
            <ScanApprovalRequestListPanel scope='mine' mode={mode} />
          </Tabs.Panel>
        )}

        {canApprove && (
          <Tabs.Panel value='approval' pt='lg'>
            <ScanApprovalRequestListPanel scope='approval' mode={mode} />
          </Tabs.Panel>
        )}
        {canApprove && (
          <Tabs.Panel value='approval-history' pt='lg'>
            <ScanApprovalRequestListPanel scope='history' mode={mode} />
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal
        opened={nextMode !== null}
        onClose={() => setNextMode(null)}
        title={t`Confirm mode change`}
        centered
      >
        <Stack>
          {switchError && <Alert color='red'>{switchError}</Alert>}
          <Alert color={nextMode === 'outbound' ? 'orange' : 'blue'}>
            {approvalEnabled && currentDraft
              ? t`The current draft is tied to one direction. Keep it for later and start a new request, or cancel it and release any outbound reservation.`
              : t`Changing mode clears the selected location, pending choices, and session results. Confirm the new stock direction before scanning again.`}
          </Alert>
          <Group justify='flex-end'>
            <Button
              variant='default'
              disabled={switching}
              onClick={() => {
                setNextMode(null);
                setSwitchError(null);
              }}
            >
              {t`Cancel`}
            </Button>
            <Button
              color={nextMode === 'outbound' ? 'orange' : 'blue'}
              variant={approvalEnabled && currentDraft ? 'light' : 'filled'}
              disabled={switching}
              onClick={confirmModeSwitch}
            >
              {approvalEnabled && currentDraft
                ? t`Keep request and switch`
                : nextMode === 'outbound'
                  ? t`Switch to outbound`
                  : t`Switch to inbound`}
            </Button>
            {approvalEnabled && currentDraft && (
              <Button
                color='red'
                loading={switching}
                onClick={() => void cancelAndSwitchMode()}
              >
                {t`Cancel request and switch`}
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
