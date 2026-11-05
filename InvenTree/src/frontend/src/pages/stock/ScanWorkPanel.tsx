import { Boundary } from '@lib/components/Boundary';
import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAlertCircle,
  // IconCamera,
  IconCheck,
  IconMapPin,
  IconQrcode,
  IconSwitchHorizontal
} from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type KeyboardEvent,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState
} from 'react';

import { api } from '../../App';
import BarcodeCameraInput from '../../components/barcodes/BarcodeCameraInput';

import { createUuid } from '../../functions/uuid';
import { useGlobalSettingsState } from '../../states/SettingsStates';
import { ScanApprovalRequestDetails } from './ScanApprovalRequestDetails';
import { ScanManualPicker } from './ScanManualPicker';
import { ScanResultList } from './ScanResultList';
import type {
  ScanMode,
  ScanSessionResult,
  ScanStockApprovalRequest,
  ScanStockApprovalRequestList,
  ScanStockCandidate,
  ScanStockResponse
} from './ScanStockTypes';
import type { WmsReceiptDetail } from './WmsContractTypes';
import { type WmsOptions, wmsError, wmsUrl } from './WmsInventoryPanel';
import { WmsProjectSelect } from './WmsProjectSelect';

// Preparation and printing are optional; their assets must not gate scanning.
const WmsReceiptWorkbench = lazy(() =>
  import('./WmsReceiptWorkbench').then((module) => ({
    default: module.WmsReceiptWorkbench
  }))
);

type LocationList = {
  results: Array<{ pk: number; name: string; pathstring: string }>;
};

type PendingScan = {
  locationId: string | null;
  barcode: string;
  clientEventId: string;
  quantity: number | string;
  batch: string;
  purpose: string;
  remark: string;
  receiptId?: number;
  quantityConfirmed?: boolean;
  projectId?: number;
};

type BarcodeLocationResponse = {
  stocklocation?: { pk?: number };
};

function errorData(error: any): ScanStockResponse | undefined {
  return error?.response?.data ?? error?.data;
}

export function ScanWorkPanel({
  mode,
  initialLocationId = null,
  onDraftChange,
  focusRequest = 0
}: Readonly<{
  mode: ScanMode;
  focusRequest?: number;
  initialLocationId?: string | null;
  onDraftChange?: (draft: ScanStockApprovalRequest | null) => void;
}>) {
  const queryClient = useQueryClient();
  const globalSettings = useGlobalSettingsState();
  const approvalEnabled = globalSettings.isSet('SCAN_APPROVAL_ENABLED');
  const inputRef = useRef<HTMLInputElement>(null);
  const [entryMode, setEntryMode] = useState<string | null>('scan');
  const [showLog, setShowLog] = useState(false);
  const [detailsOpened, setDetailsOpened] = useState(false);
  const manualQuantity = useRef<{
    barcode: string;
    quantity: number | string;
  } | null>(null);
  const [prepareOpened, setPrepareOpened] = useState(false);
  useEffect(() => {
    setEntryMode('scan');
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [mode, focusRequest]);
  const scanArmed = useRef(true);
  const lastQuantityScope = useRef('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationBarcode, setLocationBarcode] = useState('');
  const [locationProcessing, setLocationProcessing] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [queuedBarcode, setQueuedBarcode] = useState<string | null>(null);
  const [initializedLabel, setInitializedLabel] = useState('');
  const completeCode = /^WMS[0-9]+:/.test(barcode.trim());
  const [stableBarcode] = useDebouncedValue(barcode.trim(), 150);
  const [quantityConfirmed, setQuantityConfirmed] = useState(false);
  const completeDetail = useQuery<WmsReceiptDetail>({
    queryKey: ['wms-direct-label', mode, barcode.trim()],
    enabled: completeCode && stableBarcode === barcode.trim(),
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await api.post(
          wmsUrl('labels/resolve'),
          {
            barcode: barcode.trim()
          },
          { signal }
        )
      ).data
  });
  const [cameraOpened, setCameraOpened] = useState(false);
  const [quantity, setQuantity] = useState<number | string>(1);
  const [projectSelection, setProjectSelection] = useState({
    value: '',
    scope: ''
  });
  const selectionScope = JSON.stringify([mode, locationId, barcode.trim()]);
  const project = completeCode
    ? (completeDetail.data?.project ?? '')
    : mode === 'inbound' || projectSelection.scope === selectionScope
      ? projectSelection.value
      : '';
  const setProject = (value: string) =>
    setProjectSelection({ value, scope: selectionScope });
  const [purpose, setPurpose] = useState('');
  const [projectId, setProjectId] = useState<number | undefined>();
  const [remark, setRemark] = useState('');
  const [setupUnits, setSetupUnits] = useState('');
  const [setupCategory, setSetupCategory] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [scanError, setScanError] = useState('');
  const projectOptions = useQuery<WmsOptions>({
    queryKey: [
      'wms-project-options',
      mode,
      mode === 'outbound' ? locationId : null,
      barcode.trim(),
      mode === 'outbound' ? project : ''
    ],
    enabled:
      !completeCode &&
      stableBarcode === barcode.trim() &&
      (mode === 'inbound' || Boolean(locationId && barcode.trim())),
    queryFn: async ({ signal }) =>
      (
        await api.get(wmsUrl('options'), {
          signal,
          params:
            mode === 'outbound'
              ? {
                  location: locationId,
                  barcode: barcode.trim(),
                  batch: project,
                  outbound: 'true'
                }
              : { barcode: barcode.trim() || undefined }
        })
      ).data,
    refetchInterval: 15000
  });
  const stockStatus = projectOptions.data?.stock_status;
  const label =
    completeCode && !completeDetail.isError ? completeDetail.data : undefined;
  const labelStock = (label?.stock ?? []).filter(
    (item) => item.location === Number(locationId)
  );
  const labelScope = JSON.stringify([mode, barcode.trim(), locationId]);
  const scannedPart =
    !completeCode &&
    !projectOptions.isError &&
    stableBarcode === barcode.trim() &&
    barcode.trim()
      ? projectOptions.data?.scanned_part
      : null;
  const outboundReady = completeCode
    ? !completeDetail.isFetching &&
      !completeDetail.isError &&
      !!completeDetail.data?.stock?.some(
        (s) => s.location === Number(locationId) && Number(s.available) > 0
      )
    : !projectOptions.isFetching &&
      !projectOptions.isError &&
      stockStatus?.state === 'AVAILABLE' &&
      'scope' in stockStatus &&
      stockStatus.scope === 'project';
  const refreshStockOptions = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['wms-project-options'] }),
      queryClient.invalidateQueries({ queryKey: ['wms-options'] }),
      queryClient.invalidateQueries({ queryKey: ['wms-direct-label'] }),
      queryClient.invalidateQueries({ queryKey: ['wms-receipts'] })
    ]);

  // Use the posted event and submitted location, even after the input has changed.
  // A failed follow-up read must never turn a committed scan into a failed scan.
  const refreshPostedResult = async (
    data: ScanStockResponse,
    submittedLocation: unknown
  ) => {
    await refreshStockOptions();
    const event = data.event;
    if (
      !data.success ||
      event?.operation !== 'OUTBOUND' ||
      event.outcome !== 'SUCCESS' ||
      !event.part_pk_snapshot
    )
      return;
    try {
      const response = await api.get<WmsOptions>(wmsUrl('options'), {
        params: {
          outbound: 'true',
          barcode: `INV-PA${event.part_pk_snapshot}`,
          batch: event.batch_snapshot,
          location: submittedLocation
        }
      });
      if (response.data.stock_status?.state === 'NO_STOCK') {
        setResults((current) =>
          current.map((result) =>
            result.id === event.client_event_id
              ? {
                  ...result,
                  message: data.replayed
                    ? t`原出库请求已确认，当前库存已为0；未重复扣减。`
                    : t`出库成功，当前库存已为0。`
                }
              : result
          )
        );
      }
    } catch {
      setResults((current) =>
        current.map((result) =>
          result.id === event.client_event_id
            ? {
                ...result,
                message: t`出库已成功，剩余库存查询失败，请重试库存查询。`
              }
            : result
        )
      );
    }
  };
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);
  const [results, setResults] = useState<ScanSessionResult[]>([]);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [candidates, setCandidates] = useState<ScanStockCandidate[]>([]);
  const [setupName, setSetupName] = useState('');
  const [draft, setDraft] = useState<ScanStockApprovalRequest | null>(null);
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(
    null
  );

  const locations = useQuery<LocationList>({
    queryKey: ['scan-stock-locations'],
    queryFn: async () => {
      const response = await api.get<LocationList>(
        apiUrl(ApiEndpoints.stock_location_list),
        { params: { limit: 500, structural: false, ordering: 'pathstring' } }
      );
      return response.data;
    }
  });

  const activeDraft = useQuery<ScanStockApprovalRequest | null>({
    queryKey: ['scan-stock-active-draft', mode],
    enabled: approvalEnabled,
    queryFn: async () => {
      const response = await api.get<ScanStockApprovalRequestList>(
        apiUrl(ApiEndpoints.stock_scan_requests),
        {
          params: {
            mine: true,
            status: 'DRAFT',
            direction: mode.toUpperCase(),
            limit: 1
          }
        }
      );
      const summary = response.data.results[0];
      if (!summary) return null;
      const detail = await api.get<ScanStockApprovalRequest>(
        apiUrl(ApiEndpoints.stock_scan_request_detail, undefined, {
          id: summary.pk
        })
      );
      return detail.data;
    }
  });

  useEffect(() => {
    setLocationId(initialLocationId);
    setLocationBarcode('');
    setLocationMessage(null);
    setLocationError(null);
    setBarcode('');
    setDetailsOpened(false);
    manualQuantity.current = null;
    scanArmed.current = true;
    lastQuantityScope.current = '';
    setQueuedBarcode(null);
    setInitializedLabel('');
    setProjectSelection({ value: '', scope: '' });
    setPurpose('');
    setRemark('');
    setScanError('');
    setPendingScan(null);
    setCandidates([]);
    setResults([]);
    setDraft(null);
    setPendingLocationId(null);
    inputRef.current?.focus();
  }, [mode, initialLocationId]);

  useEffect(() => {
    if (mode === 'outbound')
      setProjectSelection({ value: '', scope: selectionScope });
    setScanError('');
  }, [selectionScope]);

  useEffect(() => {
    if (!approvalEnabled) {
      setDraft(null);
      setPendingLocationId(null);
    }
  }, [approvalEnabled]);

  useEffect(() => {
    if (!approvalEnabled || !activeDraft.isSuccess) return;
    setDraft(activeDraft.data);
    if (activeDraft.data) {
      setLocationId(String(activeDraft.data.location));
    }
  }, [activeDraft.data, activeDraft.isSuccess, approvalEnabled]);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    if (!label || completeDetail.isFetching || activeDraft.isPending) return;
    // A draft is tied to one actual location. Never silently move it when
    // scanning another receipt, or assume a receipt's original outbound location.
    if (draft) return;
    if (mode === 'inbound') {
      setLocationId(String(label.receipt_location));
    } else {
      const availableLocations = Array.from(
        new Set(
          (label.stock ?? [])
            .filter((item) => Number(item.available) > 0)
            .map((item) => item.location)
        )
      );
      if (availableLocations.length === 1) {
        setLocationId(String(availableLocations[0]));
      }
    }
  }, [
    mode,
    label?.pk,
    completeDetail.isFetching,
    activeDraft.isPending,
    draft?.pk
  ]);

  useEffect(() => {
    if (!label) {
      setInitializedLabel('');
      return;
    }
    if (
      !locationId ||
      completeDetail.isFetching ||
      activeDraft.isPending ||
      initializedLabel === labelScope
    )
      return;
    if (mode !== 'inbound' || lastQuantityScope.current !== labelScope) {
      setQuantityConfirmed(false);
      setQuantity(
        manualQuantity.current?.barcode === barcode.trim()
          ? manualQuantity.current.quantity
          : mode === 'inbound'
            ? Number(label.prepared_quantity)
            : labelStock.reduce(
                (total, item) => total + Number(item.available),
                0
              )
      );
      lastQuantityScope.current = labelScope;
    }
    setInitializedLabel(labelScope);
  }, [
    label,
    labelScope,
    completeDetail.isFetching,
    activeDraft.isPending,
    initializedLabel
  ]);

  useEffect(() => {
    if (
      mode !== 'outbound' ||
      project ||
      completeCode ||
      projectOptions.isFetching
    )
      return;
    const projects = projectOptions.data?.projects ?? [];
    if (!projectOptions.isError && projects.length === 1)
      setProject(projects[0]);
  }, [
    mode,
    project,
    completeCode,
    projectOptions.data,
    projectOptions.isFetching,
    selectionScope
  ]);

  const locationOptions = (locations.data?.results ?? []).map((location) => ({
    value: String(location.pk),
    label: location.pathstring || location.name
  }));

  const addResult = (result: ScanSessionResult) => {
    setResults((current) => [result, ...current].slice(0, 50));
  };

  const refreshDraft = async (requestId: number) => {
    const response = await api.get<ScanStockApprovalRequest>(
      apiUrl(ApiEndpoints.stock_scan_request_detail, undefined, {
        id: requestId
      })
    );
    setDraft(response.data.status === 'DRAFT' ? response.data : null);
    queryClient.setQueryData(['scan-stock-request', requestId], response.data);
    return response.data;
  };

  const ensureDraft = async (
    selectedLocation: string
  ): Promise<ScanStockApprovalRequest> => {
    if (
      draft?.status === 'DRAFT' &&
      draft.direction === mode.toUpperCase() &&
      draft.location === Number(selectedLocation)
    ) {
      return draft;
    }
    const response = await api.post<ScanStockApprovalRequest>(
      apiUrl(ApiEndpoints.stock_scan_requests),
      {
        direction: mode.toUpperCase(),
        location: Number(selectedLocation)
      }
    );
    setDraft(response.data);
    return response.data;
  };

  const chooseLocation = (value: string | null) => {
    if (draft && value !== null && Number(value) !== draft.location) {
      setPendingLocationId(value);
      return;
    }
    setLocationId(value);
    setLocationMessage(null);
    setLocationError(null);
  };

  const keepDraftAndChangeLocation = () => {
    setDraft(null);
    setLocationId(pendingLocationId);
    setPendingLocationId(null);
    setLocationMessage(null);
    setLocationError(null);
  };

  const cancelDraftAndChangeLocation = async () => {
    if (!draft) return;
    setProcessing(true);
    try {
      await api.post(
        apiUrl(ApiEndpoints.stock_scan_request_cancel, undefined, {
          id: draft.pk
        }),
        { note: t`Scan location changed by requester.` }
      );
      keepDraftAndChangeLocation();
    } catch (error) {
      const data = errorData(error);
      setLocationError(
        data?.error_message || t`The current request could not be cancelled.`
      );
    } finally {
      setProcessing(false);
    }
  };

  const applyScannedLocation = (location: number) => {
    if (draft && location !== draft.location) {
      setPendingLocationId(String(location));
    } else {
      setLocationId(String(location));
    }
    setLocationBarcode('');
    setLocationError(null);
    setLocationMessage(
      mode === 'inbound'
        ? t`Destination location set from barcode.`
        : t`Source location set from barcode.`
    );
  };

  const scanLocationBarcode = async () => {
    const normalized = locationBarcode.trim();
    if (!normalized) return;

    // Both inputs accept scanner keystrokes. A complete equipment label must
    // use the same validation and pending-stock flow, even in the location field.
    if (/^WMS[0-9]+:/.test(normalized)) {
      setLocationBarcode('');
      setLocationMessage(null);
      setLocationError(null);
      setScanError('');
      scanArmed.current = true;
      setBarcode(normalized);
      setQueuedBarcode(normalized);
      inputRef.current?.focus();
      return;
    }

    setLocationProcessing(true);
    setLocationMessage(null);
    setLocationError(null);
    try {
      const response = await api.post<BarcodeLocationResponse>(
        apiUrl(ApiEndpoints.barcode),
        { barcode: normalized }
      );
      const scannedLocation = response.data.stocklocation?.pk;
      if (!scannedLocation) {
        setLocationError(t`The scanned barcode is not a stock location.`);
        return;
      }
      applyScannedLocation(scannedLocation);
    } catch (_error) {
      setLocationError(t`The location barcode could not be resolved.`);
    } finally {
      setLocationProcessing(false);
    }
  };

  const submitScan = async (
    scan: PendingScan,
    extra: Record<string, unknown> = {}
  ) => {
    const selectedLocation = scan.locationId;
    if (!selectedLocation) {
      addResult({
        id: scan.clientEventId,
        barcode: scan.barcode,
        success: false,
        errorCode: 'LOCATION_REQUIRED',
        message:
          mode === 'inbound'
            ? t`Select a destination location before scanning stock.`
            : t`Select a source location before scanning stock.`
      });
      return;
    }

    if (processingRef.current) return;

    processingRef.current = true;
    setProcessing(true);
    try {
      const approvalRequest = approvalEnabled
        ? await ensureDraft(selectedLocation)
        : null;
      const endpoint =
        mode === 'inbound'
          ? ApiEndpoints.stock_scan_inbound_v2
          : ApiEndpoints.stock_scan_outbound;
      const payload = {
        barcode: scan.barcode,
        client_event_id: scan.clientEventId,
        quantity: scan.quantity,
        batch: scan.batch,
        ...(scan.projectId ? { project_id: scan.projectId } : {}),
        purpose: mode === 'outbound' ? scan.purpose : '',
        remark: scan.remark,
        ...(scan.receiptId
          ? {
              receipt_id: scan.receiptId,
              quantity_confirmed: scan.quantityConfirmed
            }
          : {}),
        ...(approvalRequest ? { approval_request_id: approvalRequest.pk } : {}),
        ...(mode === 'inbound'
          ? { destination_location: Number(selectedLocation) }
          : { source_location: Number(selectedLocation) }),
        ...extra
      };
      setRetryPayload(payload);
      const response = await api.post<ScanStockResponse>(
        apiUrl(endpoint),
        payload
      );
      const data = response.data;
      setRetryPayload(null);
      setScanError('');
      if (data.success) {
        if (detailsOpened) setDetailsOpened(false);
        manualQuantity.current = null;
      }
      if (data.success && mode === 'inbound') {
        setBarcode((current) =>
          current.trim() === scan.barcode ? '' : current
        );
      }

      if (
        !data.terminal &&
        data.error_code === 'LOCATION_BARCODE_REQUIRES_CONTEXT' &&
        data.location
      ) {
        applyScannedLocation(data.location);
        setPendingScan(null);
        setCandidates([]);
        return;
      }

      if (!data.terminal && data.error_code === 'SETUP_REQUIRED') {
        setPendingScan(scan);
        setSetupName('');
        return;
      }
      if (!data.terminal && data.error_code === 'STOCK_SELECTION_REQUIRED') {
        setPendingScan(scan);
        setCandidates(data.candidates ?? []);
        return;
      }

      addResult({
        id: data.event?.client_event_id ?? scan.clientEventId,
        barcode: scan.barcode,
        event: data.event,
        success: data.success,
        replayed: data.replayed,
        errorCode: data.error_code,
        message: data.replayed
          ? approvalEnabled
            ? t`This scan was already processed; the request quantity was not changed again.`
            : t`This scan was already processed; stock was not changed again.`
          : (!data.success ? wmsError({ data }) : '') ||
            (!approvalEnabled ? data.message : '') ||
            (approvalEnabled
              ? mode === 'outbound'
                ? t`已加入待出库`
                : t`已加入待入库`
              : t`Stock updated.`)
      });
      void refreshPostedResult(data, selectedLocation);
      if (approvalRequest) {
        await refreshDraft(approvalRequest.pk);
      }
      setPendingScan(null);
      setCandidates([]);
    } catch (error: any) {
      if (error?.response?.status >= 400 && error.response.status < 500)
        setRetryPayload(null);
      setScanError(wmsError(error));
      const data = errorData(error);
      addResult({
        id: data?.event?.client_event_id ?? scan.clientEventId,
        barcode: scan.barcode,
        event: data?.event,
        success: false,
        errorCode: data?.error_code,
        message: wmsError(error)
      });
    } finally {
      processingRef.current = false;
      setProcessing(false);
      window.setTimeout(() => {
        // Do not interrupt a different field or modal while a network reply arrives.
        const active = document.activeElement;
        if (
          !document.querySelector('[role="dialog"]') &&
          (active === inputRef.current ||
            active === document.body ||
            active?.tagName === 'BUTTON')
        ) {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }, 0);
    }
  };

  const startScanValue = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    if (/^WMS[0-9]+:/.test(normalized) && normalized !== barcode.trim()) {
      setBarcode(normalized);
      setCameraOpened(false);
      return;
    }
    if (completeCode) {
      if (
        !completeDetail.data ||
        completeDetail.isFetching ||
        completeDetail.isError
      )
        return;
      if (
        mode === 'inbound' &&
        draft &&
        draft.location !== completeDetail.data.receipt_location
      ) {
        setScanError(t`当前草稿属于其他库位，请先提交或取消该草稿。`);
        return;
      }
      if (mode === 'inbound' && completeDetail.data.state === 'CANCELLED') {
        setScanError(t`该明细已作废，不能继续扫码。`);
        return;
      }
      if (
        mode === 'inbound' &&
        Number(quantity) !== Number(completeDetail.data.prepared_quantity) &&
        !quantityConfirmed
      ) {
        setScanError(t`实际数量与准备数量不同，请明确核对确认。`);
        setDetailsOpened(true);
        return;
      }
    }
    if (
      mode === 'outbound' &&
      (normalized !== barcode.trim() || !outboundReady)
    ) {
      setScanError(t`请选择有可用库存的实际库位。`);
      setDetailsOpened(true);
      return;
    }
    if (!locationId || !(Number(quantity) > 0)) {
      setScanError(t`请选择实际库位并填写有效数量。`);
      setDetailsOpened(true);
      return;
    }
    if (!project.trim()) {
      setScanError(t`请选择项目`);
      setDetailsOpened(true);
      return;
    }
    if (retryPayload) {
      setScanError(t`请先安全重试并确认上一笔请求`);
      return;
    }
    const scan = {
      locationId,
      barcode: normalized,
      clientEventId: createUuid(),
      quantity,
      batch: project.trim(),
      projectId: completeCode
        ? (completeDetail.data?.project_id ?? undefined)
        : mode === 'inbound'
          ? projectId
          : undefined,
      purpose: purpose.trim(),
      remark: remark.trim(),
      ...(completeCode && completeDetail.data
        ? {
            receiptId: completeDetail.data.receipt,
            quantityConfirmed
          }
        : {})
    };
    scanArmed.current = false;
    void submitScan(scan);
  };

  const startScan = () => startScanValue(barcode);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key.length === 1) scanArmed.current = true;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!scanArmed.current) return;
      if (completeCode && (!retryPayload || processingRef.current)) {
        setQueuedBarcode(barcode.trim());
      } else if (!completeCode && barcode.trim()) {
        setDetailsOpened(true);
      }
    }
  };

  // HID scanners send Enter before the debounced lookup has finished. Keep
  // that scan pending until its own data and defaults are ready, never the
  // previous label's data. Editing the input cancels the pending scan.
  useEffect(() => {
    if (!queuedBarcode || queuedBarcode !== barcode.trim()) return;
    if (processing || retryPayload) return;
    if (
      stableBarcode !== queuedBarcode ||
      completeDetail.isFetching ||
      activeDraft.isPending
    )
      return;
    if (completeDetail.isError) {
      setQueuedBarcode(null);
      return;
    }
    if (label && !draft) {
      const automaticLocations =
        mode === 'inbound'
          ? [label.receipt_location]
          : Array.from(
              new Set(
                (label.stock ?? [])
                  .filter((item) => Number(item.available) > 0)
                  .map((item) => item.location)
              )
            );
      if (automaticLocations.length === 1 && !locationId) return;
    }
    if (!label || (locationId && initializedLabel !== labelScope)) return;
    setQueuedBarcode(null);
    startScanValue(queuedBarcode);
  }, [
    queuedBarcode,
    processing,
    retryPayload,
    stableBarcode,
    completeDetail.isFetching,
    completeDetail.isError,
    label,
    locationId,
    initializedLabel,
    labelScope,
    activeDraft.isPending
  ]);

  const confirmSetup = () => {
    if (
      !pendingScan ||
      !setupName.trim() ||
      !locationId ||
      !setupCategory ||
      !setupUnits.trim()
    )
      return;
    void submitScan(pendingScan, {
      create_part: {
        name: setupName.trim(),
        IPN: pendingScan.barcode,
        description: '',
        category: Number(setupCategory),
        units: setupUnits.trim(),
        default_location: Number(locationId)
      }
    });
  };

  return (
    <Stack gap='sm'>
      {scanError && <Alert color='red'>{scanError}</Alert>}
      {retryPayload && !processing && (
        <Alert color='orange'>
          <Stack>
            <Text>{t`网络结果未确认，安全重试复用原请求，避免重复入出库。`}</Text>
            <Button
              loading={processing}
              onClick={async () => {
                setProcessing(true);
                try {
                  const response = await api.post<ScanStockResponse>(
                    apiUrl(
                      retryPayload.source_location
                        ? ApiEndpoints.stock_scan_outbound
                        : ApiEndpoints.stock_scan_inbound_v2
                    ),
                    retryPayload
                  );
                  setRetryPayload(null);
                  setScanError('');
                  addResult({
                    id:
                      response.data.event?.client_event_id ??
                      String(retryPayload.client_event_id),
                    barcode: String(retryPayload.barcode),
                    event: response.data.event,
                    success: response.data.success,
                    replayed: response.data.replayed,
                    message: response.data.error_message || t`请求已确认`
                  });
                  void refreshPostedResult(
                    response.data,
                    retryPayload.source_location
                  );
                  if (draft) await refreshDraft(draft.pk);
                } catch (e) {
                  setScanError(wmsError(e));
                } finally {
                  setProcessing(false);
                }
              }}
            >{t`安全重试原请求`}</Button>
          </Stack>
        </Alert>
      )}

      <Tabs
        value={entryMode}
        onChange={(value) => {
          setEntryMode(value);
          if (value === 'scan')
            window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Tabs.List>
          <Tabs.Tab value='scan'>{t`扫码录入`}</Tabs.Tab>
          <Tabs.Tab value='manual'>{t`按名称 / 型号添加`}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value='scan' pt='sm'>
          <TextInput
            ref={inputRef}
            data-testid='equipment-scan-input'
            autoFocus
            aria-label={t`扫码（二维码／设备ID／库存项码）`}
            value={barcode}
            onChange={(event) => {
              scanArmed.current = true;
              manualQuantity.current = null;
              setQueuedBarcode(null);
              setBarcode(event.currentTarget.value);
            }}
            onPaste={() => {
              scanArmed.current = true;
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={handleKeyDown}
            placeholder={t`扫描设备标签，回车自动加入`}
            leftSection={<IconQrcode size={20} />}
            maxLength={2000}
            size='md'
          />
        </Tabs.Panel>
        <Tabs.Panel value='manual' pt='sm'>
          <ScanManualPicker
            mode={mode}
            location={locationId}
            processing={processing || Boolean(queuedBarcode)}
            onPrepare={() => setPrepareOpened(true)}
            onSelect={(detail, selectedQuantity) => {
              manualQuantity.current = {
                barcode: detail.barcode,
                quantity: selectedQuantity
              };
              scanArmed.current = true;
              setBarcode(detail.barcode);
              setQuantity(selectedQuantity);
              setQuantityConfirmed(false);
              setInitializedLabel('');
              lastQuantityScope.current = '';
              setQueuedBarcode(detail.barcode);
            }}
          />
        </Tabs.Panel>
      </Tabs>
      <Group justify='space-between' gap='xs'>
        <Text
          size='sm'
          c={results[0]?.success ? 'green' : 'dimmed'}
          aria-live='polite'
        >
          {processing
            ? t`正在加入…`
            : completeDetail.isFetching && barcode
              ? t`正在识别标签…`
              : results[0]?.message}
        </Text>
        <Group gap='xs'>
          <Text size='sm' c='dimmed'>
            {t`当前库位`}：
            {locationOptions.find((item) => item.value === locationId)?.label ||
              t`扫码后自动识别`}
          </Text>
          <Button
            variant='subtle'
            size='compact-sm'
            onClick={() => {
              setQueuedBarcode(null);
              setDetailsOpened(true);
            }}
          >
            {barcode ? t`核对信息` : t`修改库位`}
          </Button>
        </Group>
      </Group>
      {completeCode && completeDetail.isError && (
        <Alert color='red'>{wmsError(completeDetail.error)}</Alert>
      )}
      <Modal
        opened={detailsOpened}
        returnFocus={false}
        onExitTransitionEnd={() => {
          window.setTimeout(() => {
            const active = document.activeElement;
            if (
              entryMode === 'scan' &&
              !document.querySelector('[role="dialog"]') &&
              (active === document.body || active?.tagName === 'BUTTON')
            )
              inputRef.current?.focus();
          }, 0);
        }}
        onClose={() => {
          setDetailsOpened(false);
          if (entryMode === 'scan')
            window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
        title={barcode ? t`核对设备与出入库信息` : t`设置实际库位`}
        size='xl'
      >
        <Stack gap='sm'>
          {scanError && <Alert color='red'>{scanError}</Alert>}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing='sm'>
            <Select
              searchable
              clearable={!draft}
              required
              label={
                mode === 'inbound'
                  ? t`Destination location`
                  : t`Source location`
              }
              placeholder={t`Select and confirm a stock location`}
              data={locationOptions}
              value={locationId}
              onChange={chooseLocation}
              disabled={
                locations.isLoading || (completeCode && mode === 'inbound')
              }
              nothingFoundMessage={t`No stock locations found`}
            />

            <Group align='flex-end' wrap='nowrap'>
              <TextInput
                value={locationBarcode}
                onChange={(event) =>
                  setLocationBarcode(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void scanLocationBarcode();
                  }
                }}
                label={t`Location barcode`}
                placeholder={t`Scan an INV-SL or linked location barcode`}
                leftSection={<IconMapPin size={20} />}
                maxLength={500}
                style={{ flex: 1 }}
              />
              <Button
                variant='light'
                loading={locationProcessing}
                disabled={!locationBarcode.trim()}
                leftSection={<IconQrcode size={18} />}
                onClick={() => void scanLocationBarcode()}
              >
                {t`Set location`}
              </Button>
            </Group>
          </SimpleGrid>
          {locationMessage && (
            <Alert color='green' icon={<IconCheck size={18} />}>
              {locationMessage}
            </Alert>
          )}
          {locationError && (
            <Alert color='red' icon={<IconAlertCircle size={18} />}>
              {locationError}
            </Alert>
          )}

          {(completeCode || scannedPart) && (
            <SimpleGrid cols={{ base: 1, sm: 3, lg: 6 }} spacing='sm'>
              <TextInput
                label={t`设备ID`}
                readOnly
                value={label?.equipment ?? scannedPart?.IPN ?? ''}
                placeholder={t`扫码后自动填充`}
              />
              <TextInput
                label={t`设备名称`}
                readOnly
                value={label?.name ?? scannedPart?.name ?? ''}
                placeholder={t`扫码后自动填充`}
              />
              <TextInput
                label={t`品牌`}
                readOnly
                value={label?.brand ?? scannedPart?.brand ?? ''}
              />
              <TextInput
                label={t`规格`}
                readOnly
                value={label?.specification ?? scannedPart?.specification ?? ''}
              />
              <TextInput
                label={t`型号`}
                readOnly
                value={label?.model_number ?? scannedPart?.model_number ?? ''}
              />
              <TextInput
                label={t`单位`}
                readOnly
                value={label?.units ?? scannedPart?.units ?? ''}
              />
            </SimpleGrid>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            {completeCode ? (
              <TextInput
                label={t`项目`}
                readOnly
                value={label?.project ?? ''}
                placeholder={t`扫码后自动填充`}
              />
            ) : mode === 'inbound' ? (
              <WmsProjectSelect
                required
                label={t`项目`}
                value={project}
                onChange={(value, id) => {
                  setProject(value);
                  setProjectId(id);
                }}
              />
            ) : (
              <Select
                required
                searchable
                label={t`项目`}
                placeholder={t`输入设备码后选择项目`}
                disabled={!barcode.trim() || !locationId}
                value={project || null}
                onChange={(value) => setProject(value ?? '')}
                data={
                  barcode.trim() && locationId
                    ? Array.from(
                        new Set([
                          ...(projectOptions.data?.projects ?? []),
                          ...(project ? [project] : [])
                        ])
                      )
                    : []
                }
              />
            )}
            <TextInput
              label={t`合同号`}
              readOnly
              value={label?.contract_number ?? ''}
              placeholder={
                !completeCode && barcode.trim()
                  ? t`此码未包含合同号`
                  : t`扫描完整二维码后自动填充`
              }
            />
          </SimpleGrid>
          {completeCode && (
            <Stack gap='xs'>
              {completeDetail.isFetching && <Text>{t`正在识别标签…`}</Text>}
              {completeDetail.error && (
                <Alert color='red'>{wmsError(completeDetail.error)}</Alert>
              )}
              {label && (
                <Alert>
                  <Text>
                    {t`验收日期（合同起始时间）`}：
                    {label.acceptance_date || t`待验收`} · {t`质保到期日`}：
                    {label.warranty_end || t`待验收`}
                  </Text>
                  {mode === 'inbound' && (
                    <Text>
                      {t`准备数量`}：{label.prepared_quantity}
                    </Text>
                  )}
                  {mode === 'outbound' && (
                    <Text>
                      {t`当前库存`}：
                      {labelStock.reduce((n, s) => n + Number(s.quantity), 0) ??
                        0}{' '}
                      · {t`可用数量`}：
                      {labelStock.reduce(
                        (n, s) => n + Number(s.available),
                        0
                      ) ?? 0}
                    </Text>
                  )}
                </Alert>
              )}
            </Stack>
          )}
          {mode === 'outbound' && !completeCode && (
            <Alert
              color={
                projectOptions.isError
                  ? 'red'
                  : outboundReady
                    ? 'blue'
                    : 'orange'
              }
              aria-live='polite'
            >
              <Stack gap='xs'>
                {!locationId || !barcode.trim() ? (
                  <Text>{t`请选择实际库位并输入设备码查看库存。`}</Text>
                ) : projectOptions.isFetching ? (
                  <Text>{t`正在查询库存…`}</Text>
                ) : projectOptions.isError ? (
                  <Text>{t`库存查询失败，请重试。`}</Text>
                ) : stockStatus && 'quantity' in stockStatus ? (
                  <>
                    <Text>
                      {stockStatus.scope === 'all_projects'
                        ? t`当前库位该设备所有项目合计`
                        : t`当前设备、项目及实际库位`}
                    </Text>
                    <Text>
                      {t`当前库存`}: {stockStatus.quantity} {stockStatus.units}{' '}
                      · {t`可用数量`}: {stockStatus.available}{' '}
                      {stockStatus.units}
                    </Text>
                    <Text size='sm'>
                      {t`冻结数量`}: {stockStatus.frozen} · {t`业务占用数量`}:{' '}
                      {stockStatus.allocated}
                    </Text>
                    {stockStatus.state === 'NO_STOCK' ? (
                      <Text>
                        {stockStatus.scope === 'project'
                          ? t`当前项目在此库位暂无该设备库存，无法出库。`
                          : t`当前库位该设备暂无库存，无法出库。`}
                      </Text>
                    ) : stockStatus.state === 'NO_AVAILABLE_STOCK' ? (
                      <Text>{t`当前无可用库存，库存已冻结或占用。`}</Text>
                    ) : null}
                    {!project && stockStatus.state !== 'NO_STOCK' && (
                      <Text>{t`请选择项目查看可用库存`}</Text>
                    )}
                  </>
                ) : (
                  <Text>
                    {stockStatus?.error_message ||
                      t`设备码无法识别，请检查设备ID或库存项码。`}
                  </Text>
                )}
                {locationId && barcode.trim() && (
                  <Button
                    size='xs'
                    variant='subtle'
                    loading={projectOptions.isFetching}
                    onClick={() => void projectOptions.refetch()}
                  >{t`重新查询库存`}</Button>
                )}
              </Stack>
            </Alert>
          )}
          {mode === 'outbound' && (
            <TextInput
              label={t`用途`}
              description={t`选填`}
              maxLength={250}
              value={purpose}
              onChange={(e) => setPurpose(e.currentTarget.value)}
            />
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
            <TextInput
              label={t`本次扫码备注`}
              maxLength={2000}
              value={remark}
              onChange={(e) => setRemark(e.currentTarget.value)}
            />
            <NumberInput
              label={t`Quantity per scan`}
              value={quantity}
              onChange={(value) => {
                setQuantity(value);
                setQuantityConfirmed(false);
              }}
              min={0.00001}
              decimalScale={5}
            />
          </SimpleGrid>
          {completeCode &&
            mode === 'inbound' &&
            completeDetail.data &&
            Number(quantity) !==
              Number(completeDetail.data.prepared_quantity) && (
              <Checkbox
                label={t`已核对实际数量与准备数量的差异`}
                checked={quantityConfirmed}
                onChange={(e) => setQuantityConfirmed(e.currentTarget.checked)}
              />
            )}

          <Group justify='flex-end'>
            {/* 摄像头入口暂时停用，恢复时取消注释并恢复 IconCamera 导入。
              {globalSettings.isSet('BARCODE_WEBCAM_SUPPORT', true) && (
                <Button
                  size='lg'
                  variant='light'
                  leftSection={<IconCamera size={20} />}
                  onClick={() => setCameraOpened(true)}
                >
                  {t`Camera Input`}
                </Button>
              )}
              */}
            <Button
              color={mode === 'inbound' ? 'blue' : 'orange'}
              loading={processing}
              disabled={
                !barcode.trim() ||
                !locationId ||
                !project.trim() ||
                (completeCode &&
                  (completeDetail.isFetching ||
                    completeDetail.isError ||
                    !completeDetail.data)) ||
                (mode === 'outbound' && !outboundReady) ||
                !(Number(quantity) > 0)
              }
              leftSection={<IconCheck size={20} />}
              onClick={startScan}
            >
              {approvalEnabled
                ? mode === 'inbound'
                  ? t`Add pending inbound`
                  : t`加入待出库`
                : mode === 'inbound'
                  ? t`Add stock`
                  : t`Remove stock`}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={prepareOpened}
        onClose={() => {
          setPrepareOpened(false);
          void queryClient.invalidateQueries({
            queryKey: ['wms-scan-candidates']
          });
        }}
        title={t`入库填单与打印`}
        size='90%'
      >
        {prepareOpened && (
          <Boundary label='receipt-preparation'>
            <Suspense
              fallback={<Text component='output'>{t`Loading...`}</Text>}
            >
              <WmsReceiptWorkbench />
            </Suspense>
          </Boundary>
        )}
      </Modal>

      <Modal
        opened={cameraOpened}
        onClose={() => setCameraOpened(false)}
        title={t`Camera Input`}
        size='lg'
        centered
      >
        <BarcodeCameraInput
          onScan={(value) => {
            setBarcode(value);
            setScanError('');
            setCameraOpened(false);
          }}
        />
      </Modal>

      {approvalEnabled && !draft && (
        <Paper withBorder p='md' radius='sm'>
          <Title order={3}>
            {mode === 'inbound' ? t`待入库明细` : t`待出库明细`}
          </Title>
          <Text c='dimmed' size='sm' mt='sm'>
            {activeDraft.isLoading
              ? t`正在恢复待办明细…`
              : t`扫描设备标签或按名称、型号添加设备。`}
          </Text>
        </Paper>
      )}
      {approvalEnabled && draft && (
        <Paper withBorder p='md' radius='sm'>
          <ScanApprovalRequestDetails
            compact
            requestId={draft.pk}
            initialRequest={draft}
            onChanged={(request) => {
              void refreshStockOptions();
              if (request.status === 'DRAFT') {
                setDraft(request);
              } else {
                setDraft(null);
                setResults([]);
                void activeDraft.refetch();
                window.setTimeout(() => inputRef.current?.focus(), 0);
              }
            }}
          />
        </Paper>
      )}

      <Group justify='flex-end'>
        <Button
          variant='subtle'
          size='compact-sm'
          onClick={() => setShowLog((value) => !value)}
          aria-expanded={showLog}
        >
          {showLog ? t`收起扫码日志` : t`查看扫码日志`}
        </Button>
      </Group>
      <Collapse expanded={showLog}>
        <ScanResultList results={results} />
      </Collapse>

      <Modal
        opened={Boolean(pendingScan && candidates.length > 0)}
        onClose={() => {
          setPendingScan(null);
          setCandidates([]);
        }}
        title={t`Select a stock item`}
        closeOnClickOutside={false}
      >
        <Stack>
          <Alert icon={<IconAlertCircle />} color='yellow'>
            {t`当前设备、项目及地点存在多个库存项，请明确选择。`}
          </Alert>
          {candidates.map((candidate) => (
            <Card key={candidate.pk} withBorder>
              <Group justify='space-between' align='center'>
                <div>
                  <Text fw={700}>#{candidate.pk}</Text>
                  <Text size='sm'>
                    {t`项目`}: {candidate.batch || t`None`}
                  </Text>
                  <Text size='sm'>
                    {t`Available`}: {candidate.unallocated_quantity}
                  </Text>
                </div>
                <Button
                  onClick={() => {
                    if (pendingScan) {
                      void submitScan(pendingScan, {
                        stock_item_id: candidate.pk
                      });
                    }
                  }}
                >
                  {t`Select`}
                </Button>
              </Group>
            </Card>
          ))}
          {mode === 'inbound' && (
            <Button
              variant='light'
              onClick={() => {
                if (pendingScan) {
                  void submitScan(pendingScan, { create_stock_item: true });
                }
              }}
            >
              {t`Create a new stock item`}
            </Button>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(
          mode === 'inbound' && pendingScan && candidates.length === 0
        )}
        onClose={() => setPendingScan(null)}
        title={
          approvalEnabled
            ? t`Create product for pending inbound`
            : t`Create product and add stock`
        }
        closeOnClickOutside={false}
      >
        <Stack>
          <Alert color='blue'>
            {approvalEnabled
              ? t`This IPN is unknown. The setup is stored on the request; product creation and stock addition happen only if the whole request is approved.`
              : t`This IPN is unknown. Product creation, stock creation, and inbound quantity will commit together.`}
          </Alert>
          <TextInput
            readOnly
            label={t`Internal part number (IPN)`}
            description={t`The scanned code becomes the new product IPN and is used for future scans.`}
            value={pendingScan?.barcode ?? ''}
          />
          <TextInput
            required
            label={t`Product name`}
            value={setupName}
            onChange={(event) => setSetupName(event.currentTarget.value)}
          />
          <Select
            required
            searchable
            label={t`设备分类`}
            value={setupCategory}
            onChange={setSetupCategory}
            data={projectOptions.data?.categories ?? []}
          />
          <TextInput
            required
            label={t`单位`}
            value={setupUnits}
            onChange={(e) => setSetupUnits(e.currentTarget.value)}
          />
          <Button
            loading={processing}
            disabled={!setupName.trim() || !setupCategory || !setupUnits.trim()}
            onClick={confirmSetup}
          >
            {approvalEnabled
              ? t`Add product setup to request`
              : t`Create product and add stock`}
          </Button>
        </Stack>
      </Modal>

      <Modal
        opened={pendingLocationId !== null}
        onClose={() => setPendingLocationId(null)}
        title={t`Change request location`}
        centered
        closeOnClickOutside={!processing}
      >
        <Stack>
          <Alert color='orange' icon={<IconSwitchHorizontal size={18} />}>
            {t`The current request is tied to one location. Keep it and start a new request at the selected location, or cancel it and release any outbound reservation.`}
          </Alert>
          <Group justify='flex-end'>
            <Button
              variant='default'
              disabled={processing}
              onClick={() => setPendingLocationId(null)}
            >
              {t`Back`}
            </Button>
            <Button
              variant='light'
              disabled={processing}
              onClick={keepDraftAndChangeLocation}
            >
              {t`Keep request and start new`}
            </Button>
            <Button
              color='red'
              loading={processing}
              onClick={() => void cancelDraftAndChangeLocation()}
            >
              {t`Cancel request and switch`}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
