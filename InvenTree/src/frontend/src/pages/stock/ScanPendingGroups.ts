import type { ScanStockEvent } from './ScanStockTypes';

export type PendingScanGroup = {
  key: string;
  latest: ScanStockEvent;
  members: ScanStockEvent[];
  quantity: string;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
}

// Quantities are fixed precision (five decimal places) in the scan API.
// Sum scaled integers so repeated fractional scans do not drift in the UI.
function quantityUnits(value: string): bigint {
  const [integer, fraction = ''] = value.split('.');
  return (
    BigInt(integer || '0') * 100000n +
    BigInt(fraction.padEnd(5, '0').slice(0, 5))
  );
}

function quantityText(value: bigint): string {
  const fraction = String(value % 100000n)
    .padStart(5, '0')
    .replace(/0+$/, '');
  return `${value / 100000n}${fraction ? `.${fraction}` : ''}`;
}

export function sumScanQuantities(values: string[]): string {
  return quantityText(
    values.reduce((sum, value) => sum + quantityUnits(value), 0n)
  );
}

/** A display projection only. Original event IDs remain the mutation boundary. */
export function pendingScanGroups(
  lines: ScanStockEvent[],
  mergePending: boolean
): PendingScanGroup[] {
  const groups = new Map<string, PendingScanGroup>();
  const seen = new Set<number>();
  for (const line of [...lines].sort((a, b) => b.pk - a.pk)) {
    if (line.outcome !== 'PENDING' || seen.has(line.pk)) continue;
    seen.add(line.pk);
    const event = line as ScanStockEvent & {
      source_location?: number | null;
      destination_location?: number | null;
    };
    // Never infer identity from display name or an unavailable/hidden barcode.
    const identifiable =
      line.source_detail ||
      line.detail_uid_snapshot ||
      line.part_pk_snapshot ||
      line.part_ipn_snapshot ||
      line.stock_item_pk_snapshot;
    const key =
      mergePending && identifiable
        ? JSON.stringify(
            stableValue({
              approval_request: line.approval_request,
              operation: line.operation,
              source_detail: line.source_detail,
              detail_uid: line.detail_uid_snapshot,
              version: line.label_version_snapshot,
              barcode_kind: line.barcode_kind,
              part: line.part_pk_snapshot,
              ipn: line.part_ipn_snapshot,
              stock_item: line.stock_item_pk_snapshot,
              project: line.batch_snapshot,
              contract: line.contract_number_snapshot,
              source_location: event.source_location,
              destination_location: event.destination_location,
              source_path: line.source_location_path_snapshot,
              destination_path: line.destination_location_path_snapshot,
              stock_context: line.requested_stock_context,
              part_setup: line.requested_part_setup,
              unit: line.units_snapshot,
              purpose: line.purpose,
              remark: line.remark,
              acceptance: line.acceptance_date_snapshot,
              warranty_months: line.warranty_months_snapshot,
              warranty_end: line.warranty_end_snapshot
            })
          )
        : `event:${line.pk}`;
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(line);
      existing.quantity = quantityText(
        quantityUnits(existing.quantity) +
          quantityUnits(line.requested_quantity)
      );
    } else {
      groups.set(key, {
        key,
        latest: line,
        members: [line],
        quantity: quantityText(quantityUnits(line.requested_quantity))
      });
    }
  }
  return [...groups.values()];
}
