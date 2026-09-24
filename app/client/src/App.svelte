<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { Menu, Search, Lightbulb, Compass, Archive, Trash2, Tag, LayoutGrid, Rows3, Moon, Sun, Cloud, CloudOff, RefreshCw, Plus, CheckSquare, X, Download, LogOut, LockKeyhole, Check, ArrowRight, AlertCircle } from '@lucide/svelte';
  import { Capacitor } from '@capacitor/core';
  import { App as NativeApp } from '@capacitor/app';
  import { db, persist, seed, notesFor } from './db';
  import { errorMessage, request } from './api';
  import { createSession } from './session.svelte';
  import { changeVisibility, createSync, holdEditor, preserveConflict } from './sync.svelte';
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
  const account = createSession(() => { editor = null; accountOpen = false; });
  let session = $derived(account.current);
  let scope = $derived(session?.user.id || 'guest');
  let notebook = $derived(notesFor(scope));
  let notes = $derived($notebook.notes);
  let view = $state<View>('notes'), query = $state(''), sidebar = $state(window.innerWidth > 900);
  let list = $state(stored('teum-list', false)), dark = $state(stored('teum-dark', false));
  let editor = $state.raw<LocalNote | null>(null), reader = $state.raw<Note | null>(null);
  let authOpen = $state(false), accountOpen = $state(false);
  let feed = $state.raw<Note[]>([]), feedLoading = $state(false), feedError = $state('');
  let toast = $state(''), initError = $state('');
  let search: HTMLInputElement;
  let editorCurrent = $derived(editor ? notes.find(n => n.id === editor!.id) || editor : null);
  let labels = $derived([...new Set(notes.filter(n => !n.body.trashed).flatMap(n => n.body.labels))].sort());
  let title = $derived(sections.find(s => s.view === view)?.label || view.slice(6));
  let q = $derived(query.trim().toLowerCase());
  const matches = (n: Note) => [n.body.title, n.body.content, ...n.body.items.map(i => i.text), ...n.body.labels, ...(view === 'explore' ? [n.author.name] : [])].join(' ').toLowerCase().includes(q);
  let visible = $derived(notes.filter(n => view === 'trash' ? n.body.trashed : !n.body.trashed && (view === 'archive' ? n.body.archived : view.startsWith('label:') ? n.body.labels.includes(view.slice(6)) : !n.body.archived)).filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  let pinned = $derived(visible.filter(n => n.body.pinned)), others = $derived(visible.filter(n => !n.body.pinned));
  let publicNotes = $derived(feed.filter(matches));
  const notify = (text: string) => toast = text;
  const synchronizer = createSync({ session: () => session, notes: () => notes, editor: () => editor, notify });

  $effect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('teum-dark', JSON.stringify(dark)); });
  $effect(() => { localStorage.setItem('teum-list', JSON.stringify(list)); });
  $effect(() => { if (!toast) return; const t = setTimeout(() => toast = '', 4500); return () => clearTimeout(t); });
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
    const release = holdEditor(note);
    try { editor = await db.notes.get([note.scope, note.id]) || note; }
    catch { release(); notify('메모 저장소를 열 수 없습니다.'); }
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
  async function connect(next: Session, bring: boolean) {
    await account.connect(next, bring);
    editor = null; view = 'notes';
    notify('계정이 연결됐어요. 메모를 동기화합니다.');
  }
  async function logout() {
    await account.logout();
    view = 'notes'; accountOpen = false;
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: notes.map(({ body, visibility, updatedAt, id }) => ({ id, body, visibility, updatedAt })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `notizfaden-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); notify('메모를 JSON 파일로 내보냈어요.');
  }
</script>

<svelte:window onkeydown={shortcut} onpopstate={fromLink}/>

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
      <button class="sync-status" onclick={() => synchronizer.run()} title={synchronizer.error || synchronizer.status} disabled={synchronizer.syncing || !!editor}>{#if synchronizer.syncing}<RefreshCw size={17} class="spin"/>{:else if synchronizer.error}<CloudOff size={18}/>{:else}<Cloud size={18}/>{/if}<span>{synchronizer.status}</span></button>
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
    {#if synchronizer.error}<div class="banner" role="status"><CloudOff size={16}/>{synchronizer.error}<button onclick={() => synchronizer.run()}>다시 연결</button></div>{/if}
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
    {#if synchronizer.pending > 0}<p class="small">아직 동기화되지 않은 메모 {synchronizer.pending}개가 있어요. 로그아웃해도 이 기기에 보관되며 같은 계정으로 다시 로그인하면 전송합니다.</p>{/if}
  </Modal>{/if}
  {#if toast}<div class="toast" role="status"><Check size={16}/>{toast}<IconButton label="알림 닫기" icon={X} size={15} onclick={() => toast = ''}/></div>{/if}
</div>

<style>
  .topbar {
    height: 72px;
    display: flex;
    align-items: center;
    padding: 0 24px 0 12px;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    gap: 12px;
  }

  .brand-area {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 244px;
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .brand-name {
    font-family: Metropolis, Roboto, sans-serif;
    font-size: 21px;
    letter-spacing: -.6px;
    color: var(--icon);
    white-space: nowrap;
  }

  .search {
    height: 48px;
    background: var(--field);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 16px;
    border-radius: 8px;
    flex: 1;
    max-width: 660px;
    color: var(--icon);
    transition: box-shadow .2s;
  }

  .search:focus-within {
    box-shadow: var(--shadow);
    background: var(--bg);
  }

  .search input {
    width: 100%;
    border: 0;
    background: none;
    min-width: 0;
    font-size: 15px;
    outline: none;
  }

  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .search kbd {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .top-actions {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-left: auto;
  }

  .sync-status {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
    padding: 10px;
  }

  .sidebar {
    width: 264px;
    position: fixed;
    left: 0;
    top: 72px;
    bottom: 0;
    background: var(--bg);
    z-index: 15;
    padding: 20px 0 20px;
    display: flex;
    flex-direction: column;
    transition: width .18s;
  }

  .sidebar nav {
    overflow-y: auto;
    overflow-x: hidden;
  }

  .sidebar nav > button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 28px;
    min-height: 48px;
    padding: 0 22px 0 28px;
    border-radius: 0 25px 25px 0;
    text-align: left;
    color: var(--icon);
    font-size: 14px;
  }

  .sidebar nav > button > span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .sidebar nav > button:hover {
    background: var(--hover);
  }

  .sidebar nav > button.selected {
    background: var(--selected);
    color: var(--fg);
  }

  .nav-new {
    font-size: 10px !important;
    color: #4b5f88;
    letter-spacing: .2px;
    margin-left: auto;
    padding: 3px 7px;
    border-radius: 9px;
    background: var(--selected);
  }

  .nav-divider {
    margin: 17px 20px 14px;
    border-top: 1px solid var(--line);
  }

  .nav-caption {
    padding: 0 28px 12px;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: .6px;
  }

  .sidebar-footer {
    margin-top: auto;
    padding: 30px 28px 4px;
    color: var(--muted);
  }

  .footer-mark {
    font-family: Metropolis, Roboto, sans-serif;
    font-size: 21px;
    font-weight: 500;
    color: #9da8bc;
  }

  .sidebar-footer p {
    font-size: 12px;
    line-height: 1.9;
    margin: 8px 0 20px;
  }

  .sidebar-footer button {
    font-size: 11px;
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--muted);
  }

  .sidebar-closed .sidebar {
    width: 78px;
  }

  .sidebar-closed .sidebar nav > button {
    padding-left: 28px;
  }

  .sidebar-closed .sidebar nav > button > span,
  .sidebar-closed .sidebar-footer,
  .sidebar-closed .nav-caption {
    display: none;
  }

  .sidebar-closed .nav-divider {
    margin: 17px;
  }

  .drawer-shade {
    display: none;
  }

  main {
    margin-left: 280px;
    padding: 104px 36px 40px;
    max-width: 1860px;
    transition: margin-left .18s;
    min-height: 100vh;
  }

  .sidebar-closed main {
    margin-left: 88px;
  }

  .workspace-head {
    display: flex;
    align-items: center;
    gap: 15px;
    margin-bottom: 36px;
  }

  .workspace-head h1 {
    font-size: 19px;
    font-weight: 500;
    letter-spacing: -.4px;
  }

  .workspace-head > span {
    font-size: 12px;
    color: var(--muted);
  }

  .workspace-head > :global(.icon-button) {
    margin-left: auto;
  }

  .composer {
    display: flex;
    align-items: center;
    max-width: 600px;
    margin: 0 auto 42px;
    border: 1px solid #dadce0;
    border-radius: 8px;
    box-shadow: 0 1px 3px #20212438, 0 3px 7px #20212412;
    padding: 3px 8px 3px 18px;
    min-height: 54px;
    background: var(--bg);
    gap: 6px;
  }

  .composer-input {
    flex: 1;
    text-align: left;
    color: var(--icon);
    font-weight: 500;
    font-size: 14px;
    height: 44px;
  }

  .section-label {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
    letter-spacing: .5px;
    margin: 8px 0 15px 9px;
  }

  .notes-grid {
    columns: 232px;
    column-gap: 16px;
    margin-bottom: 25px;
  }

  .notes-grid.list {
    columns: 1;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .workspace-foot {
    display: flex;
    justify-content: center;
    gap: 7px;
    align-items: center;
    color: var(--muted);
    font-size: 11px;
    margin: 44px 0 10px;
    opacity: .7;
  }

  .results {
    font-size: 13px;
    color: var(--muted);
    margin-bottom: 24px;
  }

  .empty {
    min-height: 330px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    text-align: center;
    color: var(--muted);
    gap: 14px;
    padding: 24px;
  }

  .empty > :global(svg) {
    color: #c9cbd0;
    margin-bottom: 5px;
    stroke-width: 1.1;
  }

  .empty h2 {
    font-size: 18px;
    font-weight: 400;
    color: var(--icon);
  }

  .empty p {
    font-size: 13px;
    line-height: 1.8;
  }

  .empty button {
    margin-top: 12px;
  }

  .mobile-create {
    display: none;
  }

  /* Shared error styles override the default banner appearance. */
  :where(.banner),
  .conflicts > div {
    background: var(--selected);
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 12px;
    margin-bottom: 20px;
    display: flex;
    gap: 10px;
    align-items: center;
    line-height: 1.6;
  }

  .banner button,
  .conflicts button {
    white-space: nowrap;
    margin-left: auto;
    font-size: 12px;
    text-decoration: underline;
  }

  .account-action {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 14px 0;
    font-size: 13px;
    border-top: 1px solid var(--line);
  }

  :global(.account-dialog) .small {
    font-size: 11px;
    margin-top: 18px;
    margin-bottom: 0;
  }

  .toast {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    background: #303134;
    color: #fff;
    box-shadow: var(--shadow);
    padding: 8px 10px 8px 18px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    max-width: calc(100vw - 32px);
    width: max-content;
    line-height: 1.6;
  }

  .toast :global(.icon-button) {
    color: #eee;
    width: 28px;
    height: 28px;
  }

  @media (min-width: 1600px) {
    main {
      padding-left: 54px;
      padding-right: 54px;
    }

    .notes-grid {
      columns: 248px;
    }
  }

  @media (max-width: 1200px) {
    .sync-status span {
      display: none;
    }

    .top-actions {
      gap: 2px;
    }

    .topbar {
      padding-right: 16px;
    }

    .brand-area {
      width: 234px;
    }

    .workspace-head > span {
      font-size: 11px;
    }

    main {
      padding-left: 24px;
      padding-right: 24px;
    }

    .notes-grid {
      columns: 215px;
    }
  }

  @media (max-width: 900px) {
    .sidebar,
    .sidebar-closed .sidebar {
      width: 264px;
      box-shadow: 10px 0 25px #0002;
      transition: transform .2s;
    }

    .sidebar-closed .sidebar {
      transform: translateX(-100%);
    }

    .sidebar-closed .sidebar nav > button > span,
    .sidebar-closed .sidebar-footer,
    .sidebar-closed .nav-caption {
      display: initial;
    }

    .sidebar-closed .sidebar nav > button {
      padding-left: 28px;
    }

    .drawer-shade {
      display: block;
      position: fixed;
      inset: 72px 0 0;
      background: #0003;
      z-index: 14;
    }

    .brand-area {
      width: auto;
    }

    .brand-name {
      font-size: 21px;
    }

    .brand {
      gap: 8px;
    }

    .brand-area {
      gap: 6px;
    }

    main,
    .sidebar-closed main {
      margin-left: 0;
      padding: 100px 26px 40px;
    }

    .topbar {
      gap: 16px;
    }

    .notes-grid {
      columns: 210px;
    }

    .workspace-head {
      margin-bottom: 30px;
    }

    .sidebar-footer {
      display: block;
    }

    .sync-status {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .topbar {
      height: 64px;
      padding: 0 10px;
      gap: 7px;
    }

    .brand-area {
      gap: 0;
    }

    .brand {
      display: flex;
      gap: 2px;
    }

    .brand-name {
      display: none;
    }

    .brand-area > :global(.icon-button) {
      width: 34px;
    }

    .search {
      height: 42px;
      padding: 0 11px;
      gap: 8px;
    }

    .search input {
      font-size: 13px;
    }

    .search > :global(svg) {
      width: 18px;
    }

    .search kbd {
      display: none;
    }

    .top-actions {
      gap: 0;
    }

    .top-actions > :global(.icon-button) {
      width: 34px;
    }

    .top-actions .avatar {
      width: 29px;
      height: 29px;
      font-size: 12px;
      margin-left: 5px;
    }

    .sidebar {
      top: 64px;
    }

    .drawer-shade {
      inset: 64px 0 0;
    }

    main,
    .sidebar-closed main {
      padding: 89px 14px 100px;
    }

    .workspace-head {
      gap: 8px;
      margin-bottom: 26px;
      padding: 0 4px;
      flex-wrap: wrap;
    }

    .workspace-head h1 {
      font-size: 18px;
    }

    .workspace-head > span {
      font-size: 10px;
      letter-spacing: -.2px;
    }

    .composer {
      margin-bottom: 30px;
      min-height: 51px;
      padding-left: 14px;
    }

    .composer-input {
      font-size: 13px;
    }

    .notes-grid {
      columns: 2;
      column-gap: 10px;
      margin-bottom: 22px;
    }

    .section-label {
      margin-left: 5px;
      font-size: 10px;
    }

    .mobile-create {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 56px;
      height: 56px;
      border-radius: 17px;
      background: #4b5f88;
      color: #fff;
      box-shadow: 0 3px 10px #0002;
      z-index: 12;
    }

    .workspace-foot {
      margin-top: 28px;
      font-size: 10px;
    }

    .toast {
      bottom: 90px;
      font-size: 12px;
    }

    .conflicts > div,
    .banner {
      align-items: flex-start;
      flex-wrap: wrap;
    }

    .conflicts button,
    .banner button {
      margin-left: 0;
    }
  }

  @media (max-width: 360px) {
    .notes-grid {
      columns: 1;
    }

    .workspace-head > span {
      display: none;
    }

    .top-actions > :global(.icon-button) {
      width: 29px;
    }

    .search {
      padding: 0 8px;
    }
  }
</style>
