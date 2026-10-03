import { test, expect, type APIRequestContext } from '@playwright/test';
import type { Session } from '../src/model';

async function account(request: APIRequestContext) {
  const response = await request.post('/api/auth/register', { data: { username: 'sns_' + crypto.randomUUID().slice(0, 15).replaceAll('-', ''), password: 'social-browser-password' } });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Session>;
}

async function api(request: APIRequestContext, session: Session, path: string, method = 'GET', data?: unknown) {
  const response = await request.fetch('/api' + path, { method, data, headers: { Authorization: 'Bearer ' + session.token } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}

test('one feed shares query and following filters across posts and people, with independent post sorting', async ({ page, request }, info) => {
  const writer = await account(request), viewer = await account(request), quiet = await account(request);
  const keyword = '함께읽는정원' + Date.now();
  await api(request, writer, '/social/profile', 'PUT', { displayName: keyword, bio: '시를 함께 읽어요', avatar: '🌱' });
  await api(request, quiet, '/social/profile', 'PUT', { displayName: '아직 글이 없는 친구', bio: '', avatar: '🌙' });
  for (const person of [writer, quiet]) await api(request, viewer, `/social/profiles/${person.user.id}/follow`, 'PUT', { enabled: true });
  const ids: string[] = [];
  try {
    for (const title of [keyword + ' 먼저 쓴 인기 글', keyword + ' 나중에 쓴 글']) {
      const id = crypto.randomUUID(); ids.push(id);
      const note = await api(request, writer, `/notes/${id}`, 'PUT', { body: { title, content: '봄이 오면 다시 읽고 싶은 시', kind: 'text', items: [], color: 'green', labels: [], pinned: false, archived: false, trashed: false, sourceId: null }, baseRevision: 0, mutationId: crypto.randomUUID() });
      await api(request, writer, `/notes/${id}/visibility`, 'PATCH', { visibility: 'public', baseRevision: note.revision, mutationId: crypto.randomUUID() });
    }
    await api(request, viewer, `/social/notes/${ids[0]}/like`, 'PUT', { enabled: true });
    await page.setViewportSize({ width: 390, height: 844 });
    // Old bookmarks resolve to the people tab; anonymous filtering asks for login.
    await page.goto('/?view=explore');
    await expect(page).toHaveURL(/view=feed&tab=people/);
    await expect(page.getByRole('button', { name: '사람들', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('switch', { name: '팔로잉만' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('switch', { name: '팔로잉만' })).toHaveAttribute('aria-checked', 'false');
    await page.addInitScript(s => localStorage.setItem('teum-session', JSON.stringify(s)), viewer);
    await page.goto('/?view=feed');
    await expect(page.locator('.bottom-nav button')).toHaveText(['피드', '메모', '알림']);
    await expect(page.getByRole('button', { name: '게시물', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const sort = page.getByRole('combobox', { name: '게시물 정렬' });
    await expect(sort).toHaveValue('latest');
    await page.getByRole('switch', { name: '팔로잉만' }).click();
    await page.getByRole('searchbox').fill(keyword);
    await expect(page.getByTestId('social-card')).toHaveCount(2);
    await expect(page.getByTestId('social-card').first()).toContainText('나중에 쓴 글');
    await sort.selectOption('top');
    await expect(page.getByTestId('social-card').first()).toContainText('먼저 쓴 인기 글');
    await page.locator('.ranking-info summary').click();
    await expect(page.locator('.ranking-info')).toContainText('같은 사람의 반응은 한 번만');
    await page.getByRole('button', { name: '사람들', exact: true }).click();
    await expect(page.getByRole('searchbox')).toHaveValue(keyword);
    await expect(page.getByRole('switch', { name: '팔로잉만' })).toHaveAttribute('aria-checked', 'true');
    await expect(sort).toHaveCount(0);
    await expect(page.getByTestId('social-card')).toHaveCount(0);
    await expect(page.locator('.people-grid')).toContainText(keyword);
    await page.getByRole('searchbox').fill('');
    await expect(page.locator('.people-grid')).toContainText('아직 글이 없는 친구');
    await page.getByRole('switch', { name: '팔로잉만' }).click();
    await expect(page.getByRole('heading', { name: '최근 공개 메모를 쓴 사람들' })).toBeVisible();
    await expect(page.locator('.people-grid')).not.toContainText('아직 글이 없는 친구');
    await page.getByRole('searchbox').fill(keyword);
    await page.getByRole('button', { name: '게시물', exact: true }).click();
    await expect(page.getByRole('searchbox')).toHaveValue(keyword);
    await expect(sort).toHaveValue('top');
    await expect(page.getByTestId('social-card')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({ path: info.outputPath('unified-feed-mobile.png') });
    await page.getByRole('button', { name: '어두운 테마', exact: true }).click();
    await page.screenshot({ path: info.outputPath('unified-feed-mobile-dark.png') });
    await page.getByRole('searchbox').fill('일치하는글없음xyz');
    await expect(page.getByRole('heading', { name: '검색한 공개 메모를 찾지 못했어요' })).toBeVisible();
  } finally {
    for (const note of await api(request, writer, '/notes')) {
      if (note.visibility === 'public') await api(request, writer, `/notes/${note.id}/visibility`, 'PATCH', { visibility: 'private', baseRevision: note.revision, mutationId: crypto.randomUUID() });
    }
  }
});
