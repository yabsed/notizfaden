import { db, activeEditors, editorKey } from './db';
import { newNote, uid, type LocalNote, type Note, type Session, type Visibility } from './model';
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public status: number, message: string, public current?: Note) { super(message); }
}
export async function request<T>(path: string, session?: Session | null, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(response.status, error.message || '서버에 연결할 수 없습니다.', error.current); }
  return response.status === 204 ? undefined as T : response.json();
}
let running: Promise<void> | null = null;
export function sync(session: Session) {
  if (running) return running;
  const work = async () => {
    const scope = session.user.id;
    const local = await db.notes.where('scope').equals(scope).toArray();
    for (const captured of local.filter(n => n.dirty && !n.conflict && !n.syncError)) {
      try {
        const saved = await request<Note>(`/notes/${captured.id}`, session, 'PUT', { baseRevision: captured.revision, mutationId: captured.mutationId, body: captured.body });
        await db.transaction('rw', db.notes, async () => {
          const latest = await db.notes.get([scope, captured.id]);
          if (!latest) return;
          await db.notes.put(latest.mutationId === captured.mutationId ? { ...latest, ...saved, dirty: false, syncError: undefined } : { ...latest, revision: saved.revision, visibility: saved.visibility, author: saved.author });
        });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.current) {
          await db.notes.update([scope, captured.id], { conflict: e.current });
        } else if (e instanceof ApiError && [400, 404].includes(e.status)) {
          await db.notes.update([scope, captured.id], { syncError: e.message });
        } else { throw e; }
      }
    }
    const remote = await request<Note[]>('/notes', session);
    await db.transaction('rw', db.notes, async () => {
      for (const note of remote) {
        const latest = await db.notes.get([scope, note.id]);
        if (activeEditors.has(editorKey(scope, note.id))) continue;
        if (!latest || (!latest.dirty && note.revision >= latest.revision)) await db.notes.put({ ...note, scope, dirty: false, mutationId: uid() });
      }
    });
  };
  const locked = async () => navigator.locks ? navigator.locks.request(`teum-sync-${session.user.id}`, work) : work();
  running = locked().finally(() => { running = null; });
  return running;
}
export async function changeVisibility(note: LocalNote, visibility: Visibility, session: Session) {
  await sync(session);
  const latest = await db.notes.get([note.scope, note.id]);
  if (!latest || latest.dirty || latest.conflict) throw new Error('메모 저장을 마친 뒤 공개 범위를 바꿔 주세요.');
  const saved = await request<Note>(`/notes/${note.id}/visibility`, session, 'PATCH', { baseRevision: latest.revision, mutationId: uid(), visibility });
  await db.transaction('rw', db.notes, async () => {
    const current = await db.notes.get([note.scope, note.id]);
    if (!current) return;
    await db.notes.put(current.mutationId === latest.mutationId ? { ...current, ...saved } : { ...current, revision: saved.revision, visibility: saved.visibility });
  });
}
export async function preserveConflict(note: LocalNote) {
  if (!note.conflict) return;
  await db.transaction('rw', db.notes, async () => {
    const latest = await db.notes.get([note.scope, note.id]);
    if (!latest?.conflict) return;
    await db.notes.put({ ...newNote(note.scope), body: { ...latest.body, title: `${latest.body.title || '메모'} (내 수정본)`, sourceId: null, trashed: false } });
    await db.notes.put({ ...latest, ...latest.conflict, conflict: undefined, dirty: false, mutationId: uid() });
  });
}
export function errorMessage(e: unknown) { return e instanceof ApiError || (e instanceof Error && !(e instanceof TypeError) && e.name !== 'TimeoutError') ? e.message : '연결을 확인해 주세요. 메모는 이 기기에 저장되어 있어요.'; }
