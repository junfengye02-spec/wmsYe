import { expect, test } from '@playwright/test';
for (const method of ['GET', 'OPTIONS']) {
  test(`${method} transport failure stays inside table and recovers without reloading`, async ({
    page
  }) => {
    let broken = true;
    let attempts = 0;
    await page.route('**/api/recovery/**', async (route) => {
      if (broken && route.request().method() === method) {
        attempts++;
        return route.abort('failed');
      }
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(
          route.request().method() === 'GET'
            ? { count: 1, results: [{ pk: 1, name: '恢复后的库存设备' }] }
            : { actions: { GET: { name: { label: '设备名称' } } } }
        )
      });
    });
    await page.goto('/tests/fixtures/table-recovery/index.html');
    await expect
      .poll(() => attempts, { timeout: 15000 })
      .toBeGreaterThanOrEqual(6);
    await expect(
      page.getByRole('button', { name: '重试加载表格' })
    ).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/INVE-E17/)).toHaveCount(0);
    if (method === 'GET')
      await page.screenshot({ path: '/tmp/wms-table-network-recovery.png' });
    broken = false;
    await page.getByRole('button', { name: '重试加载表格' }).click();
    await expect(
      page.getByRole('cell', { name: '恢复后的库存设备' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '重试加载表格' })
    ).toHaveCount(0);
  });
}
test('HTTP 403 remains an authorization failure, not a transport retry', async ({
  page
}) => {
  await page.route('**/api/recovery/**', async (route) =>
    route.fulfill({
      status: route.request().method() === 'GET' ? 403 : 200,
      contentType: 'application/json',
      body: JSON.stringify({ detail: '没有库存查看权限' })
    })
  );
  await page.goto('/tests/fixtures/table-recovery/index.html');
  await expect(page.getByText(/INVE-E17/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: '重试加载表格' })).toHaveCount(
    0
  );
});

test('background network failure retains loaded rows and search until retry succeeds', async ({
  page
}) => {
  let broken = false;
  const searches: string[] = [];
  await page.route('**/api/recovery/**', async (route) => {
    if (route.request().method() === 'GET') {
      searches.push(
        new URL(route.request().url()).searchParams.get('search') ?? ''
      );
      if (broken) return route.abort('failed');
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        route.request().method() === 'GET'
          ? { count: 1, results: [{ pk: 1, name: '原有库存设备' }] }
          : { actions: { GET: { name: { label: '设备名称' } } } }
      )
    });
  });
  await page.goto('/tests/fixtures/table-recovery/index.html');
  await page.getByRole('textbox', { name: 'Fixture search' }).fill('合同设备');
  await expect(page.getByRole('cell', { name: '原有库存设备' })).toBeVisible();
  await expect.poll(() => searches.at(-1)).toBe('合同设备');
  broken = true;
  await page.getByRole('button', { name: 'Background refresh' }).click();
  await expect(page.getByRole('button', { name: '重试加载表格' })).toBeVisible({
    timeout: 15000
  });
  await expect(page.getByRole('cell', { name: '原有库存设备' })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Fixture search' })
  ).toHaveValue('合同设备');
  broken = false;
  await page.getByRole('button', { name: '重试加载表格' }).click();
  await expect(page.getByRole('button', { name: '重试加载表格' })).toHaveCount(
    0
  );
  expect(searches.at(-1)).toBe('合同设备');
  await expect(page.getByRole('cell', { name: '原有库存设备' })).toBeVisible();
});
