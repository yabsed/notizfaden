import { test, expect, type Locator } from '@playwright/test';
import { emptyBody } from '../src/model';
import type { Post } from '../src/social';

const ids = (cards: Locator) => cards.evaluateAll(elements => elements.map(el => (el as HTMLElement).dataset.noteId!));
const post = (id: string): Post => ({
  note: { id, body: { ...emptyBody(), title: `피드 ${id}`, content: '임시로 옮겨 읽는 본문' }, visibility: 'public', revision: 1, updatedAt: new Date().toISOString(), author: { id: 'writer', name: 'writer' } },
  profile: { id: 'writer', name: 'writer', displayName: '글쓴이', bio: '', avatar: '', followers: 0, followingCount: 0, posts: 4, following: false, blocked: false, blockedBy: false, muted: false },
  likes: 0, replies: 0, liked: false, publishedAt: new Date().toISOString(),
});

test('feed arrangement is temporary, survives detail and pagination, and defers new arrivals', async ({ page }) => {
  await page.clock.install();
  let arrivals = false;
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.route('**/api/social/feed?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const items = params.has('cursor') ? [post('c')] : arrivals ? [post('new'), post('a')] : [post('a'), post('b')];
    return route.fulfill({ json: { items, cursor: params.has('cursor') ? null : 'next' } });
  });
  await page.route('**/api/social/notes/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/replies')) return route.fulfill({ json: { items: [], cursor: null } });
    const id = path.split('/').pop()!;
    return route.fulfill({ json: post(id) });
  });
  await page.goto('/?view=feed');
  const cards = page.getByTestId('social-card');
  await expect.poll(() => ids(cards)).toEqual(['a', 'b']);
  await cards.last().locator('.card-open').dragTo(cards.first().locator('.card-open'), { targetPosition: { x: 60, y: 60 } });
  await expect.poll(() => ids(cards)).toEqual(['b', 'a']);
  await expect(page.getByText('임시 배치', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await cards.first().locator('.card-open').click();
  await expect(page.getByRole('dialog', { name: '공개 메모' })).toBeVisible();
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await expect.poll(() => ids(cards)).toEqual(['b', 'a']);
  await page.getByRole('button', { name: '메모 더 보기' }).click();
  await expect.poll(() => ids(cards)).toEqual(['b', 'a', 'c']);
  arrivals = true;
  await page.clock.fastForward(30001);
  await expect(page.getByRole('button', { name: '새 글 보기' })).toBeVisible();
  // A card pushed beyond a page boundary is retained, not mistaken for deletion.
  await expect.poll(() => ids(cards)).toEqual(['b', 'a', 'c']);
  await page.getByRole('button', { name: '원래 순서로' }).click();
  await expect.poll(() => ids(cards)).toEqual(['a', 'b', 'c']);
  await expect(page.getByText('임시 배치', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '새 글 보기' }).click();
  await expect.poll(() => ids(cards)).toEqual(['new', 'a', 'c']);
  await expect(page.getByRole('button', { name: '새 글 보기' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('unequal cards keep logical rows and displace only affected columns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixtures = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => {
    const value = post(id); value.note.body.content = ('줄마다 다른 길이의 메모\n').repeat([14, 5, 2, 7, 3, 6][i]); return value;
  });
  await page.route('**/api/social/feed?*', route => route.fulfill({ json: { items: fixtures, cursor: null } }));
  await page.goto('/?view=feed');
  const cards = page.getByTestId('social-card');
  await expect(cards).toHaveCount(6);
  const positions = () => cards.evaluateAll(elements => elements.map(el => {
    const rect = el.getBoundingClientRect(); return { id: (el as HTMLElement).dataset.noteId!, x: rect.x, y: rect.y + window.scrollY, bottom: rect.bottom + window.scrollY };
  }));
  await expect.poll(async () => {
    const values = await positions(); return values.every((v, i) => i < 3 || v.x === values[i % 3].x && v.y >= values[i - 3].bottom);
  }).toBe(true);
  const initial = await positions();
  expect(initial[0].y).toBe(initial[1].y);
  expect(initial[1].y).toBe(initial[2].y);
  expect(initial[4].y).toBeLessThan(initial[3].y);
  // The upper half of the next card must not mean "stay where you are".
  const source = cards.nth(0).locator('.card-open');
  const target = cards.nth(1).locator('.card-open');
  await source.dragTo(target, { targetPosition: { x: 60, y: 55 } });
  await expect.poll(() => ids(cards)).toEqual(['b', 'a', 'c', 'd', 'e', 'f']);
  await expect.poll(async () => (await positions()).filter(card => ['c', 'f'].includes(card.id))).toEqual(initial.filter(card => ['c', 'f'].includes(card.id)));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Moving from the second to third visible slot cannot jump to a column's bottom.
  await cards.nth(1).locator('.card-open').dragTo(cards.nth(2).locator('.card-open'), { targetPosition: { x: 60, y: 55 } });
  await expect.poll(() => ids(cards)).toEqual(['b', 'c', 'a', 'd', 'e', 'f']);
  const moved = await positions();
  expect(moved[2].y).toBe(moved[0].y);
});
