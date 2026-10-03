import { test, expect, type Page, type Locator } from '@playwright/test';
import { emptyBody } from '../src/model';

async function feed(page: Page, count = 4, width = 1536) {
  await page.setViewportSize({ width, height: 1200 });
  const profile = { id: 'writer', name: 'writer', displayName: '글쓴이', bio: '', avatar: '', followers: 0, followingCount: 0, posts: 4, following: false, blocked: false, blockedBy: false, muted: false };
  const items = Array.from({ length: count }, (_, index) => String(index + 1)).map(id => ({
    note: { id, body: { ...emptyBody(), title: id, content: '같은 크기의 메모' }, visibility: 'public', revision: 1, updatedAt: new Date().toISOString(), author: { id: 'writer', name: 'writer' } },
    profile, likes: 0, replies: 0, liked: false, publishedAt: new Date().toISOString(),
  }));
  await page.route('**/api/social/feed?*', route => route.fulfill({ json: { items, cursor: null } }));
  await page.goto('/?view=feed');
  const cards = page.getByTestId('social-card');
  await expect(cards).toHaveCount(count);
  await expect.poll(() => cards.evaluateAll(nodes => new Set(nodes.map(node => node.getBoundingClientRect().top)).size)).toBe(count === 4 ? 1 : count / 3);
  return cards;
}
const order = (cards: Locator) => cards.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.noteId!));
const positions = (cards: Locator) => cards.evaluateAll(nodes => nodes.map(node => {
  const rect = node.getBoundingClientRect();
  return { id: (node as HTMLElement).dataset.noteId!, x: Math.round(rect.left), y: Math.round(rect.top + window.scrollY) };
}));

// These two outcomes define the user-facing rule. Check actual positions before
// release as well as the committed order; an array-only check misses reflow bugs.
for (const scenario of [
  { count: 4, width: 1536, source: 4, desired: ['1', '4', '2', '3'] },
  { count: 6, width: 1280, source: 5, desired: ['1', '5', '3', '4', '2', '6'] },
]) test(`${scenario.count} cards: ${scenario.source} into 2 previews and commits the same arrangement`, async ({ page }) => {
  const cards = await feed(page, scenario.count, scenario.width);
  const original = await positions(cards);
  const start = (await cards.nth(scenario.source - 1).boundingBox())!;
  const end = (await cards.nth(1).boundingBox())!;
  await page.mouse.move(start.x + 60, start.y + 90);
  await page.mouse.down();
  await page.mouse.move(end.x + 60, end.y + 90);
  const expected = original.map(card => {
    const slot = original[scenario.desired.indexOf(card.id)];
    return { id: card.id, x: slot.x, y: slot.y };
  });
  await expect.poll(() => positions(cards)).toEqual(expected);
  await page.mouse.up();
  await expect.poll(() => order(cards)).toEqual(scenario.desired);
  await expect.poll(() => positions(cards)).toEqual(scenario.desired.map(id => expected.find(card => card.id === id)));
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
