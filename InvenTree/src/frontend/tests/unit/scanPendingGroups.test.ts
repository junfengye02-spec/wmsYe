import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pendingScanGroups,
  sumScanQuantities
} from '../../src/pages/stock/ScanPendingGroups.ts';
import type { ScanStockEvent } from '../../src/pages/stock/ScanStockTypes';

const line = (pk: number, extra: Partial<ScanStockEvent> = {}) =>
  ({
    pk,
    operation: 'INBOUND',
    outcome: 'PENDING',
    source_detail: 12,
    detail_uid_snapshot: 'label-12',
    label_version_snapshot: 1,
    part_pk_snapshot: 20,
    part_ipn_snapshot: 'EQ-20',
    part_name_snapshot: '交换机',
    barcode: '[hidden]',
    barcode_kind: 'RECEIPT_DETAIL',
    requested_quantity: '10.00000',
    batch_snapshot: '项目A',
    contract_number_snapshot: 'HT-01',
    units_snapshot: '台',
    destination_location_path_snapshot: '库位A',
    requested_stock_context: { location: 1, stock_item: null },
    requested_part_setup: {},
    purpose: '',
    remark: '',
    ...extra
  }) as ScanStockEvent;

test('same prepared source scans 10 then 20 in one displayed row, latest event remains removable', () => {
  const first = line(1);
  const latest = line(2);
  assert.equal(pendingScanGroups([first], true)[0].quantity, '10');
  const groups = pendingScanGroups([first, latest], true);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, '20');
  assert.equal(groups[0].latest.pk, 2);
  assert.deepEqual(
    groups[0].members.map((member) => member.pk),
    [2, 1]
  );
  assert.equal(first.requested_quantity, '10.00000');
  // The server deletes only the latest immutable event, not the grouped row.
  assert.equal(
    pendingScanGroups([first, { ...latest, outcome: 'FAILED' }], true)[0]
      .quantity,
    '10'
  );
});

test('different source, version, contract, unit, location, stock context or remark never merge', () => {
  for (const difference of [
    { source_detail: 13 },
    { detail_uid_snapshot: 'another-label' },
    { label_version_snapshot: 2 },
    { contract_number_snapshot: 'HT-02' },
    { units_snapshot: '米' },
    { destination_location_path_snapshot: '库位B' },
    { requested_stock_context: { location: 2 } },
    { remark: '另一备注' },
    { purpose: '另一用途' },
    { batch_snapshot: '项目B' },
    { part_pk_snapshot: 30 }
  ])
    assert.equal(
      pendingScanGroups([line(1), line(2, difference)], true).length,
      2
    );
});

test('replayed event and fractional quantities do not add phantom stock', () => {
  const first = line(1, { requested_quantity: '0.10000' });
  const second = line(2, { requested_quantity: '0.20000' });
  const groups = pendingScanGroups(
    [first, second, { ...second, replayed: true, replay_count: 1 }],
    true
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, '0.3');
  assert.equal(groups[0].members.length, 2);
});

test('latest scanned group sorts first; noncompact and unidentified events stay separate', () => {
  assert.equal(
    pendingScanGroups(
      [line(1), line(2, { source_detail: 13 }), line(3)],
      true
    )[0].latest.pk,
    3
  );
  assert.equal(pendingScanGroups([line(1), line(2)], false).length, 2);
  assert.equal(
    pendingScanGroups(
      [
        line(1, {
          source_detail: null,
          detail_uid_snapshot: null,
          part_pk_snapshot: null,
          part_ipn_snapshot: ''
        }),
        line(2, {
          source_detail: null,
          detail_uid_snapshot: null,
          part_pk_snapshot: null,
          part_ipn_snapshot: ''
        })
      ],
      true
    ).length,
    2
  );
});

test('equivalent stock context key ordering does not split a valid source', () => {
  assert.equal(
    pendingScanGroups(
      [
        line(1),
        line(2, { requested_stock_context: { stock_item: null, location: 1 } })
      ],
      true
    ).length,
    1
  );
});

test('totals retain five decimal places even for large quantities', () => {
  assert.equal(
    sumScanQuantities(['10000000000.12345', '0.00001']),
    '10000000000.12346'
  );
});

test('outbound scans merge quantities, but different stock, location, purpose or direction stay separate', () => {
  const first = line(1, {
    operation: 'OUTBOUND',
    stock_item_pk_snapshot: 42,
    requested_quantity: '1'
  });
  const second = { ...first, pk: 2 };
  const groups = pendingScanGroups([first, second], true);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, '2');
  assert.equal(groups[0].latest.pk, 2);
  assert.equal(pendingScanGroups([first], true)[0].quantity, '1');
  for (const difference of [
    { stock_item_pk_snapshot: 43 },
    { source_location_path_snapshot: '库位B' },
    { purpose: '另一用途' },
    { operation: 'INBOUND' as const }
  ])
    assert.equal(
      pendingScanGroups([first, { ...second, ...difference }], true).length,
      2
    );
});
