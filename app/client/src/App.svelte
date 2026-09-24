<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Menu, Search, Lightbulb, Compass, Archive, Trash2, Tag, LayoutGrid, Rows3, Moon, Sun, Cloud, CloudOff, RefreshCw, Plus, CheckSquare, X, Download, LogOut, LockKeyhole, Check, ArrowRight, AlertCircle } from '@lucide/svelte';
  import { Capacitor } from '@capacitor/core';
  import { App as NativeApp } from '@capacitor/app';
  import { activeEditors, editorKey, db, importGuest, persist, seed, notesFor } from './db';
  import { changeVisibility, errorMessage, preserveConflict, request, sync } from './api';
  import { hasContent, newNote, type Kind, type LocalNote, type Note, type NoteBody, type Session, type Visibility } from './model';
  import AuthDialog from './components/AuthDialog.svelte';
  import Editor from './components/Editor.svelte';
  import IconButton from './components/IconButton.svelte';
  import Modal from './components/Modal.svelte';
  import NoteCard from './components/NoteCard.svelte';
  import PublicReader from './components/PublicReader.svelte';

  type View = 'notes' | 'explore' | 'archive' | 'trash' | `label:${string}`;
  const sections: { view: View; label: string; icon: typeof Menu }[] = [
    { view: 'notes', label: '메모', icon: Lightbulb }, { view: 'explore', label: '둘러보기', icon: Compass },
    { view: 'archive', label: '보관함', icon: Archive }, { view: 'trash', label: '휴지통', icon: Trash2 }
  ];
  function stored<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  let session = $state.raw<Session | null>(stored('teum-session', null));
  let scope = $derived(session?.user.id || 'guest');
  let notebook = $derived(notesFor(scope));
  let notes = $derived($notebook.notes);
  let view = $state<View>('notes'), query = $state(''), sidebar = $state(window.innerWidth > 900);
  let list = $state(stored('teum-list', false)), dark = $state(stored('teum-dark', false));
  let editor = $state.raw<LocalNote | null>(null), reader = $state.raw<Note | null>(null);
  let authOpen = $state(false), accountOpen = $state(false);
  let feed = $state.raw<Note[]>([]), feedLoading = $state(false), feedError = $state('');
  let syncing = $state(false), syncError = $state(''), toast = $state(''), initError = $state('');
  let search: HTMLInputElement;
  let editorCurrent = $derived(editor ? notes.find(n => n.id === editor!.id) || editor : null);
  let labels = $derived([...new Set(notes.filter(n => !n.body.trashed).flatMap(n => n.body.labels))].sort());
  let pending = $derived(notes.filter(n => n.dirty && !n.conflict && !n.syncError).length);
  let title = $derived(sections.find(s => s.view === view)?.label || view.slice(6));
  let q = $derived(query.trim().toLowerCase());
  const matches = (n: Note) => [n.body.title, n.body.content, ...n.body.items.map(i => i.text), ...n.body.labels, ...(view === 'explore' ? [n.author.name] : [])].join(' ').toLowerCase().includes(q);
  let visible = $derived(notes.filter(n => view === 'trash' ? n.body.trashed : !n.body.trashed && (view === 'archive' ? n.body.archived : view.startsWith('label:') ? n.body.labels.includes(view.slice(6)) : !n.body.archived)).filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  let pinned = $derived(visible.filter(n => n.body.pinned)), others = $derived(visible.filter(n => !n.body.pinned));
  let publicNotes = $derived(feed.filter(matches));
  let status = $derived(!session ? '이 기기에 저장됨' : syncError ? '연결 대기 중' : notes.some(n => n.conflict || n.syncError) ? '저장 확인 필요' : syncing ? '동기화 중…' : pending ? '동기화 대기 중' : '동기화됨');
  const notify = (text: string) => toast = text;

  $effect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('teum-dark', JSON.stringify(dark)); });
  $effect(() => { localStorage.setItem('teum-list', JSON.stringify(list)); });
  $effect(() => { if (!toast) return; const t = setTimeout(() => toast = '', 4500); return () => clearTimeout(t); });
  $effect(() => { if (!editor) return; const key = editorKey(editor.scope, editor.id); activeEditors.add(key); return () => { activeEditors.delete(key); }; });
  $effect(() => {
    if (!session || editor) return;
    untrack(() => void doSync(true));
    const t = setInterval(() => void doSync(true), 15000); return () => clearInterval(t);
  });
  $effect(() => {
    notes;
    if (!session || editor || !pending) return;
    const t = setTimeout(() => void doSync(true), 800); return () => clearTimeout(t);
  });
  $effect(() => {
    if (view !== 'explore') return;
    untrack(() => void loadFeed());
    const t = setInterval(loadFeed, 15000); return () => clearInterval(t);
  });
  $effect(() => {
    const id = reader?.id;
    if (!id) return;
    const t = setInterval(async () => {
      try { const latest = await request<Note>(`/public/${id}`); if (reader?.id === id) reader = latest; }
      catch { if (reader?.id === id) { reader = null; notify('공개 메모를 더 이상 열람할 수 없습니다.'); } }
    }, 15000);
    return () => clearInterval(t);
  });
  onMount(() => {
    seed().catch(() => initError = '기기 저장소를 열지 못했어요. 브라우저의 저장 공간을 확인해 주세요.');
    fromLink();
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => {
      if (reader) closeReader();
      else if (editor) document.querySelector<HTMLDialogElement>('.editor-dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
      else if (authOpen) authOpen = false;
      else if (accountOpen) accountOpen = false;
      else if (sidebar) sidebar = false;
      else void NativeApp.minimizeApp();
    });
    return () => { void listener.then(h => h.remove()); };
  });
  function storageChanged(e: StorageEvent) { if (e.key === 'teum-session') { session = stored('teum-session', null); editor = null; accountOpen = false; } }
  function shortcut(e: KeyboardEvent) { if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !document.querySelector('dialog[open]')) { e.preventDefault(); search?.focus(); } }
  function fromLink() { const id = new URLSearchParams(location.search).get('note'); if (id) void readPublic(id); }
  function closeReader() { reader = null; if (location.search) history.replaceState(null, '', location.pathname); }
  function navigate(next: View) { view = next; query = ''; if (window.innerWidth <= 900) sidebar = false; }
  function create(kind: Kind = 'text') { const note = newNote(scope, kind); if (view.startsWith('label:')) note.body.labels = [view.slice(6)]; editor = note; }
  async function save(note: LocalNote, body: NoteBody) { if (hasContent(body) || notes.some(n => n.id === note.id)) await persist(note, body); }
  async function update(note: LocalNote, patch: Partial<NoteBody>) {
    try { await persist(note, { ...note.body, ...patch }); if (patch.trashed !== undefined) notify(patch.trashed ? '메모를 휴지통으로 옮겼어요.' : '메모를 복원했어요.'); }
    catch { notify('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
  }
  async function open(note: LocalNote) {
    const key = editorKey(note.scope, note.id); activeEditors.add(key);
    try { editor = await db.notes.get([note.scope, note.id]) || note; }
    catch { activeEditors.delete(key); notify('메모 저장소를 열 수 없습니다.'); }
  }
  async function doSync(silent = false) {
    if (!session) { if (!silent) notify('메모는 이 기기에 저장됩니다. 로그인하면 기기 간 동기화할 수 있어요.'); return; }
    syncing = true;
    try { await sync(session); syncError = ''; }
    catch (e) { syncError = errorMessage(e); if (!silent) notify(syncError); }
    finally { syncing = false; }
  }
  async function loadFeed() {
    feedLoading = true;
    try { feed = await request<Note[]>('/public'); feedError = ''; }
    catch { feed = []; feedError = '공개 메모를 불러오지 못했어요. 서버 연결을 확인해 주세요.'; }
    finally { feedLoading = false; }
  }
  async function readPublic(id: string) {
    try { reader = await request<Note>(`/public/${id}`); }
    catch { reader = null; feed = feed.filter(n => n.id !== id); notify('더 이상 공개되지 않은 메모입니다.'); }
  }
  async function fork(note: Note) {
    try { const current = await request<Note>(`/public/${note.id}`), next = newNote(scope); next.body = { ...current.body, pinned: false, archived: false, trashed: false, sourceId: current.id }; await persist(next, next.body); reader = null; navigate('notes'); editor = next; notify('내 비공개 메모로 복사했어요. 생각을 이어 써 보세요.'); }
    catch (e) { notify(errorMessage(e)); }
  }
  async function setVisibility(note: LocalNote, visibility: Visibility) {
    if (!session) throw new Error('먼저 로그인해 주세요.');
    await changeVisibility(note, visibility, session);
    notify(visibility === 'public' ? '이 메모를 함께 볼 수 있어요.' : '이제 나만 볼 수 있어요.');
  }
  async function connect(next: Session, bring: boolean) { if (bring) await importGuest(next.user.id); localStorage.setItem('teum-session', JSON.stringify(next)); session = next; editor = null; view = 'notes'; notify('계정이 연결됐어요. 메모를 동기화합니다.'); }
  async function logout() {
    if (!session) return;
    try { await request('/auth/logout', session, 'POST'); } catch { /* Local sign-out remains available offline. */ }
    localStorage.removeItem('teum-session'); session = null; view = 'notes'; accountOpen = false; syncError = '';
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: notes.map(({ body, visibility, updatedAt, id }) => ({ id, body, visibility, updatedAt })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `notizfaden-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); notify('메모를 JSON 파일로 내보냈어요.');
  }
</script>

<svelte:window onstorage={storageChanged} onkeydown={shortcut} onpopstate={fromLink} ononline={() => !editor && doSync(true)} onfocus={() => !editor && doSync(true)}/>

{#snippet nav(items: typeof sections)}
  {#each items as item}
    <button class:selected={view === item.view} onclick={() => navigate(item.view)} title={item.label}><item.icon size={22}/><span>{item.label}</span>{#if item.view === 'explore'}<span class="nav-new">함께</span>{/if}</button>
  {/each}
{/snippet}
{#snippet cards(items: LocalNote[])}
  <div class="notes-grid" class:list>{#each items as note (note.id)}<NoteCard {note} onOpen={() => open(note)} onChange={patch => update(note, patch)} onTag={label => navigate(`label:${label}`)}/>{/each}</div>
{/snippet}

<div class="app" class:sidebar-open={sidebar} class:sidebar-closed={!sidebar}>
  <header class="topbar">
    <div class="brand-area"><IconButton label="메뉴" icon={Menu} size={23} onclick={() => sidebar = !sidebar}/><a href="/" class="brand" aria-label="Notizfaden" onclick={e => { e.preventDefault(); navigate('notes'); }}><img class="brand-icon" src="/icon.svg" alt=""/><span class="brand-name">Notizfaden</span></a></div>
    <div class="search"><Search size={21}/><input bind:this={search} type="search" aria-label="메모 검색" placeholder={view === 'explore' ? '공개 메모에서 검색' : '메모 검색'} bind:value={query}/>{#if query}<IconButton label="검색 지우기" icon={X} size={18} onclick={() => query = ''}/>{:else}<kbd>/</kbd>{/if}</div>
    <div class="top-actions">
      <button class="sync-status" onclick={() => doSync()} title={syncError || status} disabled={syncing || !!editor}>{#if syncing}<RefreshCw size={17} class="spin"/>{:else if syncError}<CloudOff size={18}/>{:else}<Cloud size={18}/>{/if}<span>{status}</span></button>
      <IconButton label={list ? '카드 보기' : '목록 보기'} icon={list ? LayoutGrid : Rows3} size={22} onclick={() => list = !list}/>
      <IconButton label={dark ? '밝은 테마' : '어두운 테마'} icon={dark ? Sun : Moon} size={21} onclick={() => dark = !dark}/>
      <button class="avatar" title={session ? '계정' : '로그인'} aria-label={session ? '계정' : '로그인'} onclick={() => session ? accountOpen = true : authOpen = true}>{session ? session.user.name[0].toUpperCase() : '나'}</button>
    </div>
  </header>
  {#if sidebar}<button class="drawer-shade" aria-label="메뉴 닫기" onclick={() => sidebar = false}></button>{/if}
  <aside class="sidebar"><nav aria-label="메모 탐색">
    {@render nav(sections.slice(0, 2))}<div class="nav-divider"></div><div class="nav-caption">라벨</div>
    {#each labels as label}<button class:selected={view === `label:${label}`} onclick={() => navigate(`label:${label}`)} title={label}><Tag size={20}/><span>{label}</span></button>{/each}
    <div class="nav-divider"></div>{@render nav(sections.slice(2))}
  </nav><div class="sidebar-footer"><span class="footer-mark">Notizfaden</span><p>나를 위해 적고,<br/>가끔은 함께.</p><button onclick={exportNotes}><Download size={14}/> 메모 내보내기</button></div></aside>
  <main>
    {#if $notebook.error || initError}<div class="banner error" role="alert">{$notebook.error || initError}</div>{/if}
    {#if syncError}<div class="banner" role="status"><CloudOff size={16}/>{syncError}<button onclick={() => doSync()}>다시 연결</button></div>{/if}
    <div class="workspace-head"><h1>{title}</h1><span>{view === 'explore' ? '누군가의 작은 생각이, 나의 다음 생각으로.' : view === 'trash' ? '잠시 내려놓은 메모. 언제든 복원할 수 있어요.' : view === 'archive' ? '지금은 꺼내두지 않아도 되는 생각들.' : '떠오른 생각을 가볍게 남겨보세요.'}</span>{#if view === 'explore'}<IconButton label="공개 메모 새로고침" icon={RefreshCw} size={18} spin={feedLoading} disabled={feedLoading} onclick={loadFeed}/>{/if}</div>
    {#if view !== 'explore' && view !== 'trash' && view !== 'archive' && !query}<div class="composer"><button class="composer-input" onclick={() => create()}>메모 작성…</button><IconButton label="새 체크리스트" icon={CheckSquare} size={23} onclick={() => create('checklist')}/><IconButton label="새 메모" icon={Plus} size={24} onclick={() => create()}/></div>{/if}
    {#if query}<p class="results">“{query}” 검색 결과</p>{/if}
    {#if view === 'explore'}
      {#if feedError}<div class="empty"><CloudOff size={48}/><h2>잠깐, 연결이 필요해요</h2><p>{feedError}</p><button class="text-button" onclick={loadFeed}>다시 시도</button></div>
      {:else if publicNotes.length}<div class="notes-grid" class:list>{#each publicNotes as note (note.id)}<NoteCard {note} own={false} onOpen={() => readPublic(note.id)} onFork={() => fork(note)} onTag={label => query = label}/>{/each}</div>
      {:else}<div class="empty"><Compass size={52}/><h2>{feedLoading ? '생각을 불러오고 있어요' : '첫 번째 생각을 기다리는 중'}</h2><p>메모의 공개 범위를 ‘전체 공개’로 바꾸면<br/>이곳에서 함께 볼 수 있어요.</p><button class="text-button" onclick={() => session ? navigate('notes') : authOpen = true}>{session ? '내 메모로 가기' : '계정 연결하기'}<ArrowRight size={16}/></button></div>{/if}
    {:else}
      {#each notes.filter(n => n.syncError) as note (note.id)}<div class="banner"><AlertCircle size={18}/><span>‘{note.body.title || '메모'}’ 동기화: {note.syncError}</span><button onclick={() => note.body.sourceId ? update(note, { sourceId: null }) : open(note)}>{note.body.sourceId ? '출처 없이 저장' : '메모 수정'}</button></div>{/each}
      {#if notes.some(n => n.conflict)}<div class="conflicts">{#each notes.filter(n => n.conflict) as note (note.id)}<div><AlertCircle size={18}/><span>‘{note.body.title || '메모'}’에 다른 기기의 수정이 있어요. 두 내용을 모두 보관할 수 있습니다.</span><button onclick={() => preserveConflict(note).then(() => notify('내 수정본은 새 비공개 메모로 보관했어요.')).catch(() => notify('저장에 실패했어요. 다시 시도해 주세요.'))}>두 버전 보관</button></div>{/each}</div>{/if}
      {#if !visible.length}
        <div class="empty">{#if view === 'trash'}<Trash2 size={52}/>{:else if view === 'archive'}<Archive size={52}/>{:else if query}<Search size={52}/>{:else}<Lightbulb size={52}/>{/if}<h2>{query ? '일치하는 메모가 없어요' : view === 'trash' ? '휴지통이 비어 있어요' : view === 'archive' ? '보관한 메모가 없어요' : '첫 생각을 남겨보세요'}</h2><p>{query ? '다른 단어나 라벨로 찾아보세요.' : '짧은 문장도, 정리되지 않은 생각도 좋아요.'}</p></div>
      {:else}
        {#if pinned.length}<h2 class="section-label">고정된 메모</h2>{@render cards(pinned)}{/if}
        {#if others.length}{#if pinned.length}<h2 class="section-label">다른 메모</h2>{/if}{@render cards(others)}{/if}
      {/if}
    {/if}
    {#if view === 'notes' && !query && visible.length}<div class="workspace-foot"><LockKeyhole size={12}/><span>메모는 기본적으로 나만 볼 수 있어요.</span></div>{/if}
  </main>
  <button class="mobile-create" aria-label="새 메모" onclick={() => create()}><Plus size={28}/></button>
  {#if editorCurrent}{#key editorCurrent.id}<Editor note={editorCurrent} onClose={() => editor = null} onSave={save} onVisibility={setVisibility} {session} onSource={readPublic}/>{/key}{/if}
  {#if reader}<PublicReader note={reader} onClose={closeReader} onFork={() => reader && fork(reader)}/>{/if}
  {#if authOpen}<AuthDialog onClose={() => authOpen = false} onSession={connect}/>{/if}
  {#if accountOpen && session}<Modal label="내 계정" onClose={() => accountOpen = false} class="account-dialog">
    <div class="dialog-heading"><span class="avatar">{session.user.name[0].toUpperCase()}</span><IconButton label="닫기" icon={X} onclick={() => accountOpen = false}/></div>
    <h2>{session.user.name}의 메모장</h2><p>메모는 이 기기에 자동으로 저장되고,<br/>연결되면 계정의 다른 기기에도 반영됩니다.</p>
    <button class="account-action" onclick={exportNotes}><Download size={18}/> 내 메모 내보내기</button><button class="account-action" onclick={logout}><LogOut size={18}/> 로그아웃</button>
    {#if pending > 0}<p class="small">아직 동기화되지 않은 메모 {pending}개가 있어요. 로그아웃해도 이 기기에 보관되며 같은 계정으로 다시 로그인하면 전송합니다.</p>{/if}
  </Modal>{/if}
  {#if toast}<div class="toast" role="status"><Check size={16}/>{toast}<IconButton label="알림 닫기" icon={X} size={15} onclick={() => toast = ''}/></div>{/if}
</div>
