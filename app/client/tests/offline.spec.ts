import { test, expect } from '@playwright/test';
// Production preview must be running on :5174. This verifies the service worker,
// not Vite's development server (which intentionally has no service worker).
test('installed web shell and notes reopen fully offline', async ({ browser }) => {
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto('http://localhost:5174/');
  await expect(page.getByTestId('note-card')).toHaveCount(8);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
  await page.getByRole('button', { name: '메모 작성…', exact: true }).click();
  await page.getByRole('textbox', { name: '메모 내용' }).fill('인터넷 없이도 남아 있는 메모');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await context.setOffline(true); await page.reload();
  await expect(page.getByText('인터넷 없이도 남아 있는 메모', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '인터넷 없이도 남아 있는 메모 열기', exact: true }).click();
  await page.getByRole('textbox', { name: '메모 내용' }).fill('오프라인에서 수정한 메모');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(page.getByText('오프라인에서 수정한 메모', { exact: true })).toBeVisible();
  await context.close();
});
