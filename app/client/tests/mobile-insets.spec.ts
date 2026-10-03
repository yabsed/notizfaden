import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function setInsets(page: import('@playwright/test').Page, bottom = 34) {
  // Emulate the values supplied by Capacitor, including cutouts in landscape.
  await page.evaluate(bottom => {
    const style = document.documentElement.style;
    style.setProperty('--safe-area-inset-top', '28px');
    style.setProperty('--safe-area-inset-bottom', `${bottom}px`);
    style.setProperty('--safe-area-inset-left', '12px');
    style.setProperty('--safe-area-inset-right', '12px');
  }, bottom);
}

test('mobile controls stay clear of system bars and cutouts', async ({ page }) => {
  await page.goto('/');
  await setInsets(page);
  await expect(page.getByTestId('note-card')).toHaveCount(8);
  const search = await page.getByRole('searchbox').boundingBox();
  expect(search!.y).toBeGreaterThanOrEqual(28);
  const create = await page.locator('.mobile-create').boundingBox();
  expect(create!.y + create!.height).toBeLessThanOrEqual(844 - 34);
  expect(create!.x + create!.width).toBeLessThanOrEqual(390 - 12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '메뉴', exact: true }).click();
  const sidebar = await page.locator('.sidebar').boundingBox();
  const header = await page.locator('.topbar').boundingBox();
  expect(sidebar!.y).toBe(header!.y + header!.height);
});

test('editor tools stay visible when the viewport shrinks and content scrolls', async ({ page }) => {
  await page.goto('/');
  await setInsets(page);
  await page.getByRole('button', { name: '메모 작성…', exact: true }).click();
  await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill('긴 메모\n'.repeat(60));

  for (const height of [844, 440, 320, 844]) {
    await page.setViewportSize({ width: 390, height });
    // SystemBars removes the navigation inset while the keyboard is showing.
    const bottom = height < 844 ? 0 : 34;
    await setInsets(page, bottom);
    const back = await page.getByRole('button', { name: '메모 닫기', exact: true }).boundingBox();
    expect(back!.y).toBeGreaterThanOrEqual(28);
    const close = page.getByRole('button', { name: '닫기', exact: true });
    await expect(close).toBeInViewport({ ratio: 1 });
    const bounds = await close.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height - bottom);
    await page.getByRole('button', { name: '색상 바꾸기', exact: true }).last().click();
    await expect(close).toBeInViewport({ ratio: 1 });
  }

  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('note-card').filter({ hasText: '긴 메모' })).toHaveCount(1);
});
