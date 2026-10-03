import { untrack } from 'svelte';
import { request, errorMessage } from './api';
import type { Session } from './model';
import type { Post, Profile } from './social';

export type Reactions = Pick<Post, 'likes' | 'replies' | 'liked'>;

// Personal notes stay in IndexedDB. Reactions are revalidated, in memory,
// independently of autosave, and are discarded when the account changes.
export function createNotebookSocial(source: {
  session: () => Session | null;
  enabled: () => boolean;
  revision: () => string;
}) {
  let profile = $state.raw<Profile | null>(null);
  let reactions = $state.raw<Record<string, Reactions>>({});
  let error = $state('');
  let sequence = 0, accountToken: string | undefined;
  const pending = new Set<string>();

  async function refresh() {
    const session = source.session();
    if (!session || pending.size) return;
    const ticket = ++sequence;
    try {
      const [person, summaries] = await Promise.all([
        request<Profile>(`/social/profiles/${session.user.id}`, session),
        request<(Reactions & { id: string })[]>('/social/reactions', session)
      ]);
      if (ticket !== sequence || source.session()?.token !== session.token) return;
      const next = Object.fromEntries(summaries.map(value => [value.id, value]));
      profile = person; reactions = next; error = '';
    } catch (e) { if (ticket === sequence) error = errorMessage(e); }
  }

  async function like(id: string) {
    const session = source.session(), current = reactions[id] || { likes: 0, replies: 0, liked: false };
    if (!session || pending.has(id)) return;
    const key = `${session.token}:${id}`;
    pending.add(id); sequence++;
    try {
      const post = await request<Post>(`/social/notes/${id}/like`, session, 'PUT', { enabled: !current.liked });
      if (source.session()?.token === session.token) {
        reactions = { ...reactions, [id]: { likes: post.likes, replies: post.replies, liked: post.liked } };
        error = '';
      }
    } finally { if (key === `${source.session()?.token}:${id}`) pending.delete(id); }
  }

  $effect(() => {
    const token = source.session()?.token, enabled = source.enabled(); source.revision();
    untrack(() => {
      if (accountToken !== token) { accountToken = token; profile = null; reactions = {}; error = ''; pending.clear(); }
    });
    if (!token || !enabled) return;
    void untrack(refresh);
    const timer = setInterval(() => void refresh(), 30000);
    const resume = () => void refresh();
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => { sequence++; clearInterval(timer); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); };
  });

  return { get profile() { return profile; }, get reactions() { return reactions; }, get error() { return error; }, refresh, like };
}
