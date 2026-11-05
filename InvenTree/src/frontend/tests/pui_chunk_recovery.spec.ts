import { expect, test } from '@playwright/test';
test('production CSS preload failure preserves unrelated form and reloads only after consent', async ({
  page
}) => {
  let broken = true;
  await page.route('**/assets/page-*.css', async (route) =>
    broken ? route.abort('failed') : route.continue()
  );
  await page.goto('/');
  await expect(page.getByText(/Unable to preload CSS/)).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Unsubmitted form' })
    .fill('尚未提交的内容');
  await expect(
    page.getByRole('button', { name: '重新加载页面资源' })
  ).toBeVisible();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('未提交');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: '重新加载页面资源' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Unsubmitted form' })
  ).toHaveValue('尚未提交的内容');
  broken = false;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载页面资源' }).click();
  await expect(
    page.getByRole('heading', { name: '批次页面加载成功' })
  ).toBeVisible();
  await expect(page.getByText(/INVE-E17/)).toHaveCount(0);
});
test('persistent preload failure has no automatic reload loop', async ({
  page
}) => {
  let documentRequests = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documentRequests++;
  });
  await page.route('**/assets/page-*.css', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '重新加载页面资源' })
  ).toBeVisible();
  expect(documentRequests).toBe(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载页面资源' }).click();
  await expect(page.getByText(/Unable to preload CSS/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '重新加载页面资源' })
  ).toBeVisible();
  expect(documentRequests).toBe(2);
});
test('ordinary render errors are not classified as resource failures', async ({
  page
}) => {
  await page.goto('/?crash=1');
  await expect(
    page.getByText('ordinary render failure', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '重新加载页面资源' })
  ).toHaveCount(0);
});

test('production route JavaScript import failure recovers after explicit reload', async ({
  page
}) => {
  let broken = true;
  await page.route('**/assets/page-*.js', (route) =>
    broken ? route.abort('failed') : route.continue()
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: '重新加载页面资源' })
  ).toBeVisible();
  broken = false;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '重新加载页面资源' }).click();
  await expect(
    page.getByRole('heading', { name: '批次页面加载成功' })
  ).toBeVisible();
});
