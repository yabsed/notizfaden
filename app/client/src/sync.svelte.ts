import { onMount, untrack } from 'svelte';
import { db } from './db';
import { ApiError, errorMessage, request } from './api';
import { newNote, uid, type LocalNote, type Note, type Session, type Visibility } from './model';

// An open editor retains its base revision until the user has finished.
const activeEditors = new Set<string>();
const editorKey = (scope: string, id: string) => `${scope}:${id}`;
export function holdEditor(note: LocalNote) {
  const key = editorKey(note.scope, note.id);
  activeEditors.add(key);
  return () => { activeEditors.delete(key); };
}

const needsUpload = (note: LocalNote) => note.dirty && !note.conflict && !note.syncError;

let running: Promise<void> | null = null;
export function sync(session: Session) {
  if (running) return running;
  const work = async () => {
    const scope = session.user.id;
    const local = await db.notes.where('scope').equals(scope).toArray();
    for (const captured of local.filter(needsUpload)) {
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

interface SyncSources {
  session: () => Session | null;
  notes: () => LocalNote[];
  editor: () => LocalNote | null;
  notify: (message: string) => void;
}

// Created during component initialization so all effects/listeners share its lifetime.
export function createSync(source: SyncSources) {
  let syncing = $state(false);
  let error = $state('');
  const pending = $derived(source.notes().filter(needsUpload).length);
  const status = $derived(
    !source.session() ? '이 기기에 저장됨'
    : error ? '연결 대기 중'
    : source.notes().some(note => note.conflict || note.syncError) ? '저장 확인 필요'
    : syncing ? '동기화 중…'
    : pending ? '동기화 대기 중' : '동기화됨'
  );

  async function run(silent = false) {
    const session = source.session();
    if (!session) {
      if (!silent) source.notify('메모는 이 기기에 저장됩니다. 로그인하면 기기 간 동기화할 수 있어요.');
      return;
    }
    syncing = true;
    try { await sync(session); error = ''; }
    catch (e) { error = errorMessage(e); if (!silent) source.notify(error); }
    finally { syncing = false; }
  }

  $effect(() => {
    const editor = source.editor();
    if (editor) return holdEditor(editor);
  });
  $effect(() => {
    if (!source.session()) { error = ''; return; }
    if (source.editor()) return;
    untrack(() => void run(true));
    const timer = setInterval(() => void run(true), 15000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    source.notes();
    if (!source.session() || source.editor() || !pending) return;
    const timer = setTimeout(() => void run(true), 800);
    return () => clearTimeout(timer);
  });
  onMount(() => {
    const resume = () => { if (!source.editor()) void run(true); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => {
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
    };
  });

  return {
    get syncing() { return syncing; },
    get error() { return error; },
    get pending() { return pending; },
    get status() { return status; },
    run,
  };
}
