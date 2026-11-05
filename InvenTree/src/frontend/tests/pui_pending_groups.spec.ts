import { expect, test } from '@playwright/test';
for (const direction of ['INBOUND', 'OUTBOUND'] as const) {
  test(`${direction}: same source displays 10 then 20, replay stays 20 and undo removes only latest event`, async ({
    page
  }) => {
    const deletions: string[] = [];
    let count = 1;
    const line = (pk: number) => ({
      pk,
      operation: direction,
      outcome: 'PENDING',
      source_detail: 12,
      detail_uid_snapshot: 'label-12',
      label_version_snapshot: 1,
      part_pk_snapshot: 20,
      part_ipn_snapshot: 'EQ-20',
      part_name_snapshot: '交换机',
      barcode_kind: 'RECEIPT_DETAIL',
      stock_item_pk_snapshot: 42,
      source_location_path_snapshot: '库位A',
      requested_quantity: '10.00000',
      batch_snapshot: '项目A',
      contract_number_snapshot: 'HT-01',
      units_snapshot: '台',
      destination_location_path_snapshot: '库位A',
      requested_stock_context: {},
      requested_part_setup: {},
      purpose: '',
      remark: ''
    });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'DELETE') {
        deletions.push(path);
        count = 1;
      }
      const request = {
        pk: 1,
        reference: 'TEST-1',
        direction,
        status: 'DRAFT',
        requester: 1,
        location: 1,
        location_path_snapshot: '库位A',
        active_line_count: count,
        line_count: count,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        lines: Array.from({ length: count }, (_, i) => line(i + 1))
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          path.includes('/attachments/')
            ? { results: [], can_upload: false }
            : request
        )
      });
    });
    await page.goto('/tests/fixtures/pending-groups/index.html');
    await expect(page.getByRole('cell', { name: '交换机 EQ-20' })).toHaveCount(
      1
    );
    await expect(
      page.getByRole('cell', { name: '10 台', exact: true })
    ).toBeVisible();
    count = 2;
    await page.getByRole('button', { name: 'Refresh fixture' }).click();
    await expect(
      page.getByRole('cell', { name: '20 台 累计扫码 2 次' })
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: '交换机 EQ-20' })).toHaveCount(
      1
    );
    await expect(
      page.getByText('明细：1 · 20 台', { exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Refresh fixture' }).click();
    await expect(
      page.getByRole('cell', { name: '20 台 累计扫码 2 次' })
    ).toBeVisible();
    await page
      .getByRole('button', { name: '撤销最近一次', exact: true })
      .click();
    await expect(
      page.getByRole('cell', { name: '10 台', exact: true })
    ).toBeVisible();
    expect(deletions).toEqual(['/api/stock/scan/requests/1/lines/2/']);
    await expect(
      page.getByRole('button', { name: 'Remove', exact: true })
    ).toBeVisible();
  });
}

for (const direction of ['INBOUND', 'OUTBOUND'] as const) {
  test(`${direction}: approval opens on grouped details, exports full quantity and confirms only once`, async ({
    page
  }) => {
    const posts: string[] = [];
    let status = 'PENDING_APPROVAL';
    const line = (pk: number) => ({
      pk,
      operation: direction,
      outcome: status === 'COMPLETED' ? 'SUCCESS' : 'PENDING',
      source_detail: 12,
      part_pk_snapshot: 20,
      part_name_snapshot: '核对设备',
      part_ipn_snapshot: 'EQ-20',
      requested_quantity: '10.00000',
      applied_quantity: status === 'COMPLETED' ? '10.00000' : '0',
      units_snapshot: '台',
      model_number: 'S5735',
      brand: '华为',
      batch_snapshot: '项目A',
      contract_number_snapshot: 'HT-01',
      source_location_path_snapshot: '库位A',
      destination_location_path_snapshot: '库位A'
    });
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'POST') {
        posts.push(path);
        status = 'COMPLETED';
      }
      await route.fulfill({
        json: path.includes('/attachments/')
          ? { results: [], can_upload: false }
          : {
              pk: 1,
              reference: 'SA-TEST',
              direction,
              status,
              requester: 2,
              requester_display_name_snapshot: '操作员',
              can_approve: true,
              can_cancel: false,
              approval_owner_snapshot: { name: '审批组' },
              location: 1,
              location_path_snapshot: '库位A',
              expires_at: '2030-01-01T12:00:00Z',
              created_at: '2026-11-05T01:00:00Z',
              submitted_at: '2026-11-05T02:00:00Z',
              lines: [line(1), line(2)],
              active_line_count: 2
            }
      });
    });
    await page.goto('/tests/fixtures/pending-groups/index.html?review');
    await expect(
      page.getByRole('heading', {
        name: direction === 'INBOUND' ? '入库审批单' : '出库审批单'
      })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: '核对设备 EQ-20' })
    ).toHaveCount(1);
    await expect(page.getByText('明细：1 · 数量合计：20 台')).toBeVisible();
    const bounds = await page
      .getByRole('cell', { name: '核对设备 EQ-20' })
      .boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(768);
    await expect(page.getByText('Created', { exact: true })).not.toBeVisible();
    await page.screenshot({
      path: `/tmp/wms-approval-${direction}.png`,
      fullPage: true
    });
    await page.getByRole('textbox', { name: '搜索明细' }).fill('不存在');
    await expect(
      page.getByRole('cell', { name: '核对设备 EQ-20' })
    ).toHaveCount(0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出明细' }).click();
    const file = await download;
    const stream = await file.createReadStream();
    let csv = '';
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv).toContain('20 台');
    expect(csv).toContain('核对设备');
    await page.getByRole('tab', { name: '审批记录' }).click();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    await page
      .getByRole('tab', {
        name: direction === 'INBOUND' ? '到货单附件' : '出库单附件'
      })
      .click();
    await expect(page.getByRole('button', { name: /上传|补充/ })).toHaveCount(
      0
    );
    await page.getByRole('tab', { name: /设备明细/ }).click();
    await page.getByRole('textbox', { name: '搜索明细' }).fill('');
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Reject', exact: true })
    ).toHaveCount(1);
    await page
      .getByRole('button', { name: 'Reject', exact: true })
      .first()
      .click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    expect(posts).toHaveLength(0);
    await expect(page.getByRole('textbox', { name: 'Reason' })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page
      .getByRole('button', { name: 'Approve', exact: true })
      .first()
      .click();
    expect(posts).toHaveLength(0);
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toBe('/api/stock/scan/requests/1/approve/');
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    await expect(page.getByText('明细：2 · 数量合计：20 台')).toBeVisible();
  });
}
