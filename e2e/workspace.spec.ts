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
