import { test, expect } from '@playwright/test';

test('request and response panels remain usable in the viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  const editor = page.getByRole('region', { name: 'Request editor' });
  const viewer = page.getByRole('region', { name: 'Response viewer' });
  await expect(editor).toBeVisible();
  await expect(viewer).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize request and response panels' })).toBeVisible();
  const a = await editor.boundingBox(), b = await viewer.boundingBox();
  expect(a?.height).toBeGreaterThan(160);
  expect(b?.height).toBeGreaterThan(160);
  expect((b?.y || 0) + (b?.height || 0)).toBeLessThanOrEqual(page.viewportSize()!.height + 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-workspace.png` });
});

test('parameter rows scroll inside the request panel instead of disappearing', async ({ page }) => {
  await page.goto('/');
  const editor = page.locator('.request-editor-content');
  await expect(editor.getByRole('button', { name: 'Add row' })).toBeVisible();
  for (let i = 0; i < 18; i++) await editor.getByRole('button', { name: 'Add row' }).click();
  expect(await editor.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await editor.getByRole('button', { name: 'Add row' }).scrollIntoViewIfNeeded();
  await expect(editor.getByRole('button', { name: 'Add row' })).toBeInViewport();
  await expect(page.getByRole('region', { name: 'Response viewer' })).toBeVisible();
});

test('keyboard splitter resizing is persisted after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  const separator = page.getByRole('separator', { name: 'Resize request and response panels' });
  const initial = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await separator.press('ArrowDown');
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 5));
  await page.reload();
  await expect(separator).toHaveAttribute('aria-valuenow', String(initial + 5));
  await page.screenshot({ path: `test-results/${testInfo.project.name}-resized.png` });
});

test('mobile toolbar remains inside the viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-specific layout');
  await page.goto('/');
  const theme = page.getByTitle('Switch to light theme');
  await expect(theme).toBeVisible();
  const rect = await theme.boundingBox();
  expect((rect?.x || 0) + (rect?.width || 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const menu = page.locator('details.data-menu');
  await expect(menu.locator('summary')).toBeVisible();
  await menu.locator('summary').click();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import backup' })).toBeVisible();
  const popup = await page.locator('.data-menu-popup').boundingBox();
  expect(popup).not.toBeNull();
  expect((popup?.x || 0) + (popup?.width || 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(popup?.y).toBeGreaterThanOrEqual(0);
});


test('proxy cookie jar is opt-in and persists locally without using network', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Request URL' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Request URL' }).fill('https://api.example.com/auth');
  await page.getByRole('button', { name: 'Cookie Jar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cookie Jar' });
  await expect(dialog).toBeVisible();
  const toggle = dialog.getByRole('checkbox', { name: 'Enable Cloud Proxy cookie capture and sending' });
  await expect(toggle).not.toBeChecked();
  await dialog.getByRole('textbox', { name: 'Cookie name' }).fill('qa-session');
  await dialog.getByLabel('Cookie value').fill('secret-123');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('qa-session')).toBeVisible();
  await toggle.check();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Cookie Jar' }).click();
  await expect(dialog.getByText('qa-session')).toBeVisible();
  await expect(toggle).toBeChecked();
  await dialog.getByRole('button', { name: 'Delete cookie qa-session' }).click();
  await expect(dialog.getByText('qa-session')).toHaveCount(0);
});


test('Local Agent pairing UI keeps its token in tab memory only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Local Agent' });
  await expect(dialog).toBeVisible();
  const token = dialog.getByLabel('Agent pairing token');
  await token.fill('temporary-key-never-persisted');
  await expect(dialog.getByText('127.0.0.1:47831', { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Local Agent' }).getByLabel('Agent pairing token')).toHaveValue('');
});


test('gRPC unary console offers proto import, target, RPC method and JSON editors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog=page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('gRPC target')).toHaveValue('grpc://127.0.0.1:50051');
  await expect(dialog.getByLabel('gRPC service')).toHaveValue('demo.Greeter');
  await expect(dialog.getByLabel('gRPC method')).toHaveValue('SayHello');
  await expect(dialog.getByLabel('gRPC proto')).toHaveValue(/service Greeter/);
  await expect(dialog.getByLabel('gRPC request JSON')).toBeVisible();
  await expect(dialog.getByLabel('gRPC metadata JSON')).toBeVisible();
  await expect(dialog.getByRole('button', { name:'Invoke RPC' })).toBeDisabled();
  await dialog.getByRole('button', { name:'Pair Agent' }).click();
  await expect(page.getByRole('dialog', { name:'Local Agent' })).toBeVisible();
});


test('gRPC supports local schema files and reflection selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog=page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog.getByRole('button', { name:'Local .proto files' })).toBeVisible();
  await expect(dialog.getByRole('button', { name:'Choose files' })).toBeVisible();
  await dialog.getByRole('button', { name:'Server Reflection' }).click();
  await expect(dialog.getByRole('button', { name:'List services' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name:'Load RPC methods' })).toBeDisabled();
  await expect(dialog.getByText('reflection API')).toBeVisible();
  await dialog.getByRole('button', { name:'Local .proto files' }).click();
  await expect(dialog.getByLabel('gRPC proto')).toBeVisible();
});


test('saved gRPC RPC is listed in Collections and restored after reload', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name:'gRPC Console' }).click();
  const dialog = page.getByRole('dialog', { name:'gRPC Console' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name:'Saved gRPC name' }).fill('Demo Watch');
  await dialog.getByRole('combobox', { name:'gRPC call mode' }).selectOption('server-stream');
  await dialog.getByRole('button', { name:'Save', exact:true }).click();
  await expect(dialog.getByText('Saved to collection.')).toBeVisible();
  await dialog.getByTitle('Close').click();
  await page.reload();
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name:'Toggle menu' }).click();
  await page.getByRole('button', { name:/RPC Demo Watch/ }).click();
  const restored = page.getByRole('dialog', { name:'gRPC Console' });
  await expect(restored.getByRole('textbox', { name:'Saved gRPC name' })).toHaveValue('Demo Watch');
  await expect(restored.getByRole('combobox', { name:'gRPC call mode' })).toHaveValue('server-stream');
});
