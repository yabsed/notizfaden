import { test, expect, type Locator } from '@playwright/test';

const ids = (cards: Locator) => cards.evaluateAll(elements => elements.map(el => (el as HTMLElement).dataset.noteId!));

test('desktop drag preserves pinned groups, filtered order, edits and reloads', async ({ page }) => {
  await page.goto('/?view=notes');
  await expect(page.getByTestId('note-card')).toHaveCount(8);
  const pinned = page.locator('.notes-grid').first().getByTestId('note-card');
  const cards = page.locator('.notes-grid').last().getByTestId('note-card');
  const pinnedBefore = await ids(pinned), before = await ids(cards);
  const source = page.locator(`[data-note-id="${before[1]}"] .card-open`);
  const target = page.locator(`[data-note-id="${before[0]}"] .card-open`);
  await source.dragTo(target, { targetPosition: { x: 80, y: 60 } });
  const desired = [before[1], before[0], ...before.slice(2)];
  await expect.poll(() => ids(cards)).toEqual(desired);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => ids(pinned)).toEqual(pinnedBefore);
  // Cross-group drops do not implicitly pin/unpin a card.
  await page.locator(`[data-note-id="${desired[0]}"] .card-open`).dragTo(pinned.first().locator('.card-open'), { targetPosition: { x: 80, y: 60 } });
  await expect.poll(() => ids(cards)).toEqual(desired);
  await page.reload();
  await expect.poll(() => ids(cards)).toEqual(desired);
  await page.locator(`[data-note-id="${desired[3]}"] .card-open`).click();
  await page.getByRole('textbox', { name: '메모 내용' }).click();
  await page.getByRole('textbox', { name: '메모 내용' }).fill('수정해도 제자리에 있는 카드');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect.poll(() => ids(cards)).toEqual(desired);
  // Filtering only moves the chosen card; hidden cards retain relative order.
  await page.getByRole('searchbox').fill('생각');
  const filtered = page.locator('.notes-grid').last().getByTestId('note-card');
  const filteredBefore = await ids(filtered);
  expect(filteredBefore.length).toBeGreaterThan(1);
  const moved = filteredBefore[filteredBefore.length - 1];
  await filtered.last().locator('.card-open').press('Alt+Home');
  await expect.poll(() => ids(filtered)).toEqual([moved, ...filteredBefore.slice(0, -1)]);
  await page.getByRole('searchbox').fill('');
  const expected = desired.filter(id => id !== moved);
  expected.splice(expected.indexOf(filteredBefore[0]), 0, moved);
  await expect.poll(() => ids(cards)).toEqual(expected);
});

test('touch long press reorders offline and survives an offline reload', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto((process.env.NOTIZFADEN_PREVIEW_URL || 'http://localhost:5176') + '/?view=notes');
    await expect(page.getByTestId('note-card')).toHaveCount(8);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBeTruthy();
    const cards = page.locator('.notes-grid').first().getByTestId('note-card');
    const before = await ids(cards);
    await context.setOffline(true);
    const handle = await cards.last().boundingBox();
    const target = await cards.first().boundingBox();
    expect(handle).toBeTruthy(); expect(target).toBeTruthy();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: handle!.x + 60, y: handle!.y + 80 }] });
    await expect(cards.last()).toHaveAttribute('data-reorder-ready', '');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target!.x + 70, y: target!.y + 60 }] });
    await expect(cards.last()).toHaveAttribute('data-drop', 'preview');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => ids(cards)).toEqual([...before].reverse());
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect.poll(() => ids(cards)).toEqual([...before].reverse());
  } finally { await context.close(); }
});

test('offline ordering syncs across devices without changing note data', async ({ page, browser, request }) => {
  const response = await request.post('/api/auth/register', { data: { username: 'sns_' + crypto.randomUUID().replaceAll('-', '').slice(0, 14), password: 'social-browser-password' } });
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  const headers = { Authorization: 'Bearer ' + session.token };
  for (const title of ['첫 메모', '둘째 메모', '셋째 메모']) {
    const saved = await request.put('/api/notes/' + crypto.randomUUID(), { headers, data: { body: { title, content: '본문', kind: 'text', items: [], color: 'green', labels: [], pinned: false, archived: false, trashed: false, sourceId: null }, baseRevision: 0, mutationId: crypto.randomUUID() } });
    expect(saved.ok()).toBeTruthy();
  }
  const original = await (await request.get('/api/notes', { headers })).json();
  await page.addInitScript(s => localStorage.setItem('teum-session', JSON.stringify(s)), session);
  await page.goto('/?view=notes');
  const cards = page.getByTestId('note-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.sync-status')).toHaveText('동기화됨');
  const before = await ids(cards), desired = [before[1], before[2], before[0]];
  await page.context().setOffline(true);
  await cards.first().locator('.card-open').press('Alt+End');
  await expect.poll(() => ids(cards)).toEqual(desired);
  await page.context().setOffline(false);
  await page.locator('.sync-status').click();
  await expect.poll(async () => (await (await request.get('/api/note-order', { headers })).json()).ids).toEqual(desired);
  const device = await browser.newContext();
  try {
    await device.addInitScript(s => localStorage.setItem('teum-session', JSON.stringify(s)), session);
    const second = await device.newPage();
    await second.goto('/?view=notes');
    await expect.poll(() => ids(second.getByTestId('note-card'))).toEqual(desired);
    expect(await (await request.get('/api/notes', { headers })).json()).toEqual(original);
    await second.getByTestId('note-card').first().locator('.card-open').press('Alt+ArrowRight');
    const latest = [desired[1], desired[0], desired[2]];
    await expect.poll(async () => (await (await request.get('/api/note-order', { headers })).json()).ids).toEqual(latest);
    await page.locator('.sync-status').click();
    await expect.poll(() => ids(cards)).toEqual(latest);
    // A delayed acknowledgement must not erase a newer local arrangement.
    let acknowledge!: () => void;
    const gate = new Promise<void>(resolve => { acknowledge = resolve; });
    let sending = false;
    await page.route('**/api/note-order', async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      const response = await route.fetch();
      sending = true;
      await gate;
      await route.fulfill({ response });
    }, { times: 1 });
    await cards.first().locator('.card-open').press('Alt+End');
    await expect.poll(() => sending).toBeTruthy();
    await cards.first().locator('.card-open').press('Alt+End');
    const newest = [latest[2], latest[0], latest[1]];
    await expect.poll(() => ids(cards)).toEqual(newest);
    acknowledge();
    await expect.poll(async () => (await (await request.get('/api/note-order', { headers })).json()).ids, { timeout: 20000 }).toEqual(newest);
    await expect.poll(() => ids(cards)).toEqual(newest);
    await second.locator('.sync-status').click();
    await expect.poll(() => ids(second.getByTestId('note-card'))).toEqual(newest);
  } finally { await device.close(); }
});

test('card gesture uses distance, keeps clicks and controls, and edits at the clicked text position', async ({ page }) => {
  await page.goto('/?view=notes');
  await page.getByRole('button', { name: '메모 작성…', exact: true }).click();
  await page.getByRole('textbox', { name: '메모 제목' }).fill('거리 기준');
  await page.getByRole('textbox', { name: '메모 내용' }).fill('abcdef');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  const card = page.getByTestId('note-card').filter({ hasText: '거리 기준' });
  await expect(page.locator('[data-reorder-handle]')).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  const box = (await card.locator('.card-text').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(500); // A stationary long mouse press is still a click.
  await page.mouse.move(box.x + 23, box.y + 12);
  await expect(page.locator('[data-drag-ghost]')).toHaveCount(0);
  await page.mouse.up();
  const content = page.getByRole('textbox', { name: '메모 내용' });
  await expect(content).toHaveAttribute('contenteditable', 'false');
  await expect(page.getByRole('button', { name: '서식 도구', exact: true })).toHaveCount(0);
  const caret = await content.locator('p').evaluate(el => {
    const range = document.createRange(); range.setStart(el.firstChild!, 2); range.collapse(true);
    const rect = range.getBoundingClientRect(); return { x: rect.x, y: rect.y + rect.height / 2 };
  });
  await page.mouse.click(caret.x, caret.y);
  await expect(content).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.insertText('!');
  await expect(content).toHaveText('ab!cdef');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await card.hover();
  await card.getByRole('button', { name: '메모 고정', exact: true }).click();
  await expect(card.getByRole('button', { name: '고정 해제', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await ids(page.getByTestId('note-card'));
  await card.scrollIntoViewIfNeeded();
  const start = (await card.locator('.card-text').boundingBox())!;
  await page.mouse.move(start.x + 20, start.y + 10); await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y + 10);
  await expect(page.locator('[data-drag-ghost]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('[data-drag-ghost]')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await ids(page.getByTestId('note-card'))).toEqual(before);
});


test('ordinary touch swipes scroll without moving or opening cards', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto((process.env.NOTIZFADEN_TEST_URL || 'http://localhost:5175') + '/?view=notes');
    await expect(page.getByTestId('note-card')).toHaveCount(8);
    const before = await ids(page.getByTestId('note-card'));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 480 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 300 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await ids(page.getByTestId('note-card'))).toEqual(before);
    await expect(page.locator('[data-drag-ghost]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await context.close(); }
});
