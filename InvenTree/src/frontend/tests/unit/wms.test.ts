import assert from 'node:assert/strict';
import test from 'node:test';
import type { UserProps } from '../../lib/types/User';
import {
  canViewStockHistory,
  isWmsBusinessPath,
  wmsAccess
} from '../../src/functions/wms.ts';

test('stock history is restricted to stock-viewing approvers and administrators', () => {
  const user = (permissions: object, extra = {}) =>
    ({ permissions, ...extra }) as unknown as UserProps;
  assert.equal(canViewStockHistory(undefined), false);
  assert.equal(
    canViewStockHistory(user({ stockitem: ['view', 'change'] })),
    false
  );
  assert.equal(
    canViewStockHistory(
      user({ stockitem: ['view'], scanstockapprovalrequest: ['approve'] })
    ),
    true
  );
  assert.equal(
    canViewStockHistory(user({ scanstockapprovalrequest: ['approve'] })),
    false
  );
  assert.equal(canViewStockHistory(user({}, { is_staff: true })), true);
  assert.equal(canViewStockHistory(user({}, { is_superuser: true })), true);
});

test('operators and approvers receive separate workspaces', () => {
  const operator = {
    permissions: { stockitem: ['view', 'change'] }
  } as unknown as UserProps;
  const approver = {
    permissions: { stockitem: ['view'], scanstockapprovalrequest: ['approve'] }
  } as unknown as UserProps;
  assert.deepEqual(wmsAccess(operator, true), {
    restricted: true,
    canOperate: true,
    canApprove: false,
    home: '/stock/scan/inbound/'
  });
  assert.deepEqual(wmsAccess(approver, true), {
    restricted: true,
    canOperate: false,
    canApprove: true,
    home: '/stock/scan/inbound/?tab=approval'
  });
  assert.equal(
    wmsAccess({ ...operator, is_staff: true }, true).restricted,
    false
  );
  assert.equal(
    wmsAccess({ ...operator, is_superuser: true }, true).restricted,
    false
  );
  assert.equal(wmsAccess(operator, false).restricted, false);
  assert.equal(wmsAccess(undefined, true).restricted, false);
});

test('business routes exclude dashboard and administrative routes', () => {
  for (const path of [
    '/part/12/',
    '/stock',
    '/stock/location/index/stock-items',
    '/stock/item/12/',
    '/stock/scan/inbound/',
    '/stock/statistics/',
    '/notifications',
    '/settings/user/profile'
  ]) {
    assert.equal(isWmsBusinessPath(path), true, path);
  }
  for (const path of [
    '/',
    '/home',
    '/settings/admin',
    '/core/index/users',
    '/sales/',
    '/manufacturing/',
    '/stock/transfer-order/1',
    '/stock/statistics-admin/',
    '/part-admin'
  ]) {
    assert.equal(isWmsBusinessPath(path), false, path);
  }
});
