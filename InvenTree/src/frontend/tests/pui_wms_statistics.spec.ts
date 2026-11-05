import { type Page, expect, test } from '@playwright/test';

async function setup(page: Page, canUpload = true, canViewAttachments = true) {
  const queries: URLSearchParams[] = [];
  const uploads: string[] = [];
  const files: any[] = [];
  const row = {
    pk: 1,
    name: 'POE交换机',
    IPN: 'EQ-01',
    brand: '华三',
    model_number: 'S5130S-10P',
    batch: '历史项目',
    contract_number: 'HT-2026-008',
    quantity: '10.00000',
    units: '台',
    location: '大数据仓库 / A-01',
    operator: '王明',
    approver: '李华',
    completed_at: '2026-11-04T01:32:00Z',
    approval_request: 7,
    can_view_attachments: canViewAttachments,
    reference: 'SA-20261104-001',
    attachment_count: 0,
    acceptance_date: '2026-11-01',
    warranty_end: '2027-11-01',
    remark: '',
    purpose: '项目领用'
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let body: any = {};
    if (url.pathname === '/api/stock/wms/options/')
      body = {
        projects: [],
        locations: [{ value: '1', label: '大数据仓库 / A-01' }]
      };
    if (url.pathname === '/api/stock/wms/records/') {
      queries.push(url.searchParams);
      if (url.searchParams.has('export')) {
        await route.fulfill({
          contentType: 'text/csv',
          body: '项目,数量\n历史项目,10'
        });
        return;
      }
      body = {
        count: 51,
        results: [{ ...row, attachment_count: files.length }],
        statistics: {
          record_count: 51,
          part_count: 3,
          units: { 台: '120.00000', 米: '8.50000' }
        }
      };
    }
    if (url.pathname === '/api/stock/scan/requests/7/') {
      body = {
        pk: 7,
        reference: row.reference,
        direction: 'INBOUND',
        status: 'COMPLETED',
        location: 1,
        location_path_snapshot: row.location,
        requester_display_name_snapshot: row.operator,
        created_at: row.completed_at,
        submitted_at: row.completed_at,
        decided_at: row.completed_at,
        decision_note: '审核通过',
        lines: [
          {
            pk: 1,
            outcome: 'SUCCESS',
            part_name_snapshot: 'POE交换机',
            part_ipn_snapshot: 'EQ-01',
            model_number: 'S5130S-10P',
            brand: '华三',
            batch_snapshot: row.batch,
            contract_number_snapshot: row.contract_number,
            applied_quantity: '10',
            units_snapshot: '台',
            completed_at: row.completed_at,
            approver_snapshot: row.approver
          },
          {
            pk: 2,
            outcome: 'SUCCESS',
            part_name_snapshot: '网线',
            part_ipn_snapshot: 'EQ-02',
            model_number: 'CAT6',
            brand: '测试品牌',
            batch_snapshot: row.batch,
            contract_number_snapshot: row.contract_number,
            applied_quantity: '8.5',
            units_snapshot: '米',
            completed_at: row.completed_at
          },
          {
            pk: 3,
            outcome: 'FAILED',
            part_name_snapshot: '已移除设备',
            applied_quantity: '0',
            units_snapshot: '台'
          }
        ]
      };
    }
    if (url.pathname === '/api/stock/scan/requests/7/attachments/') {
      if (request.method() === 'POST') {
        expect(request.headers()['content-type']).toContain(
          'multipart/form-data; boundary='
        );
        uploads.push(request.postData() ?? '');
        const file = {
          pk: 1,
          name: '到货单.pdf',
          uploaded_at: '2026-11-04T02:00:00Z',
          uploaded_by: '王明',
          note: '完成后补充',
          size: 12
        };
        files.push(file);
        body = file;
      } else body = { results: files, can_upload: canUpload };
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
  await page.goto('/tests/fixtures/wms-statistics/index.html');
  await expect(
    page.getByRole('cell', { name: '华三', exact: true })
  ).toBeVisible();
  return { queries, uploads };
}

test('filters old projects, switches direction, keeps units separate and exports all matches', async ({
  page
}) => {
  const state = await setup(page);
  await expect(
    page.getByText('成功记录数：51 · 设备种类数：3 · 数量小计：120 台；8.5 米')
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: '库存流水' })).toHaveCount(0);
  await page.getByLabel('项目', { exact: true }).fill('历史项目');
  await page.getByLabel('合同号', { exact: true }).fill('HT-2026-008');
  await page.getByLabel('设备型号', { exact: true }).fill('S5130S');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.get('batch')).toBe('历史项目');
  await page.getByRole('tab', { name: '出库记录', exact: true }).click();
  await expect
    .poll(() => state.queries.at(-1)?.get('operation'))
    .toBe('OUTBOUND');
  await page.getByRole('button', { name: '导出查询结果' }).click();
  await expect.poll(() => state.queries.at(-1)?.get('export')).toBe('csv');
  const exported = state.queries.at(-1)!;
  expect(exported.get('batch')).toBe('历史项目');
  expect(exported.get('contract')).toBe('HT-2026-008');
  expect(exported.get('model_number')).toBe('S5130S');
  expect(exported.has('offset')).toBe(false);
  expect(exported.has('limit')).toBe(false);
  await page.getByRole('tab', { name: '入库记录', exact: true }).click();
  await page.screenshot({
    path: '/tmp/wms-statistics-implemented.png',
    fullPage: true
  });
});

test('allows optional attachment upload from a completed posted record', async ({
  page
}) => {
  const state = await setup(page);
  await page.getByRole('button', { name: '查看 / 补充' }).click();
  await expect(
    page.getByText('SA-20261104-001', { exact: false })
  ).toBeVisible();
  await page.getByLabel('附件说明（选填）').fill('完成后补充');
  await page.locator('input[type=file]').setInputFiles({
    name: '到货单.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n')
  });
  await expect(page.getByText('到货单.pdf', { exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0]).toContain('完成后补充');
  await expect(
    page.getByText('王明 · 2026/11/4 10:00:00 · 完成后补充', { exact: true })
  ).toBeVisible();
});

test('respects attachment read-only permission', async ({ page }) => {
  await setup(page, false);
  await page.getByRole('button', { name: '查看 / 补充' }).click();
  await expect(page.getByText('暂未上传附件，可稍后补充。')).toBeVisible();
  await expect(page.getByRole('button', { name: '上传附件' })).toHaveCount(0);
});

test('does not expose attachment controls without request visibility', async ({
  page
}) => {
  await setup(page, false, false);
  await expect(page.getByText('无单据查看权限', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看 / 补充' })).toHaveCount(
    0
  );
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(page.getByRole('button', { name: '上传附件' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看审批单' })).toHaveCount(0);
});

test('new contract requires and submits its project', async ({ page }) => {
  const writes: any[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: any = {};
    if (path === '/api/stock/wms/projects/')
      body = {
        results: [{ pk: 7, code: '项目A', active: true, description: '' }]
      };
    if (path === '/api/stock/wms/contracts/') {
      body = { results: [] };
      if (request.method() === 'POST') {
        const data = request.postDataJSON();
        writes.push(data);
        body = {
          ...data,
          pk: 1,
          project: '项目A',
          updated_at: '2026-11-04T00:00:00Z'
        };
      }
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
  await page.goto('/tests/fixtures/wms-statistics/index.html?view=contracts');
  await page.getByRole('button', { name: '新建合同', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: '合同号', exact: true })
    .fill('HT-001');
  await expect(
    page.getByRole('button', { name: '确认保存合同' })
  ).toBeDisabled();
  await page.getByRole('combobox', { name: '所属项目' }).click();
  await page.getByRole('option', { name: '项目A', exact: true }).click();
  await page.getByRole('button', { name: '确认保存合同' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].project_id).toBe(7);
  expect(writes[0].number).toBe('HT-001');
});

test('opens complete batch page, searches within it, exports all lines and restores statistics filters', async ({
  page
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setup(page);
  await page.getByLabel('设备名称 / 编号', { exact: true }).fill('POE');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByRole('button', { name: '查看', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '入库批次明细' })
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('cell', { name: '网线', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('本批全部明细：2 条 · 数量合计：10 台；8.5 米')
  ).toBeVisible();
  await expect(page.getByText('已移除设备', { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: '/tmp/wms-batch-detail-implemented.png',
    fullPage: true
  });
  await page.getByRole('textbox', { name: '搜索本批明细' }).fill('CAT6');
  await expect(
    page.getByRole('cell', { name: 'POE交换机', exact: true })
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出本批明细' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain('POE交换机');
  expect(csv).toContain('网线');
  expect(csv).not.toContain('已移除设备');
  await page.getByRole('tab', { name: '到货单附件', exact: true }).click();
  await expect(page.getByLabel('附件说明（选填）')).toBeVisible();
  await page.getByRole('tab', { name: '审批记录', exact: true }).click();
  await expect(page.getByText('审核通过', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回统计查询' }).click();
  await expect(page.getByLabel('设备名称 / 编号', { exact: true })).toHaveValue(
    'POE'
  );
});
