<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Menu, Search, Lightbulb, Archive, Trash2, Tag, LayoutGrid, Rows3, Moon, Sun, Cloud, CloudOff, RefreshCw, Plus, CheckSquare, X, Download, LogOut, LockKeyhole, Check, ArrowRight, AlertCircle, House, Bell } from '@lucide/svelte';
  import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
  import { App as NativeApp } from '@capacitor/app';
  import { db, persist, seed, notesFor } from './db';
  import { errorMessage, request } from './api';
  import { createSession } from './session.svelte';
  import { changeVisibility, createSync, holdEditor, preserveConflict, sync } from './sync.svelte';
  import { hasContent, newNote, uid, type Kind, type LocalNote, type Note, type NoteBody, type Session, type Visibility } from './model';
  import AuthDialog from './components/AuthDialog.svelte';
  import Editor from './components/Editor.svelte';
  import IconButton from './components/IconButton.svelte';
  import Modal from './components/Modal.svelte';
  import NoteCard from './components/NoteCard.svelte';
  import PublicReader from './components/PublicReader.svelte';
  import SocialView from './components/SocialView.svelte';
  import { type Post, type NotificationPage } from './social';
  import { createNotebookSocial } from './notebookSocial.svelte';

  type View = 'feed' | 'profile' | 'notifications' | 'notes' | 'archive' | 'trash' | `label:${string}`;
  const sections: { view: View; label: string; icon: typeof Menu }[] = [
    { view: 'feed', label: '피드', icon: House },
    { view: 'notes', label: '메모', icon: Lightbulb }, { view: 'notifications', label: '알림', icon: Bell },
    { view: 'archive', label: '보관함', icon: Archive }, { view: 'trash', label: '휴지통', icon: Trash2 }
  ];
  function stored<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  const account = createSession(() => { readSequence++; editor = null; reader = null; accountOpen = false; targetProfile = ''; unread = 0; view = 'notes'; query = ''; });
  let session = $derived(account.current);
  let scope = $derived(session?.user.id || 'guest');
  let notebook = $derived(notesFor(scope));
  let notes = $derived($notebook.notes);
  let view = $state<View>(account.current ? 'feed' : 'notes'), query = $state(''), sidebar = $state(window.innerWidth > 900);
  let list = $state(stored('teum-list', false)), dark = $state(stored('teum-dark', false));
  let editor = $state.raw<LocalNote | null>(null), reader = $state.raw<Note | null>(null);
  let authOpen = $state(false), accountOpen = $state(false);
  let targetProfile = $state(''), unread = $state(0), socialRevision = $state(0);
  let feedTab = $state<'posts' | 'people'>('posts');
  let visibilityFilter = $state<'all' | Visibility>('all');
  let isSocial = $derived(['feed', 'profile', 'notifications'].includes(view));
  const scrollPositions = new Map<string, number>();
  let restoreScroll: number | null = null, readSequence = 0;
  let toast = $state(''), initError = $state('');
  let search: HTMLInputElement;
  let editorCurrent = $derived(editor ? notes.find(n => n.id === editor!.id) || editor : null);
  let labels = $derived([...new Set(notes.filter(n => !n.body.trashed).flatMap(n => n.body.labels))].sort());
  let ownProfile = $derived(view === 'profile' && (!targetProfile || targetProfile === session?.user.id));
  let title = $derived(ownProfile ? '메모' : view === 'profile' ? '프로필' : sections.find(s => s.view === view)?.label || view.slice(6));
  let q = $derived(query.trim().toLowerCase());
  const matches = (n: Note) => [n.body.title, n.body.content, ...n.body.items.map(i => i.text), ...n.body.labels].join(' ').toLowerCase().includes(q);
  let visible = $derived(notes.filter(n => view === 'trash' ? n.body.trashed : !n.body.trashed && (view === 'archive' ? n.body.archived : view.startsWith('label:') ? n.body.labels.includes(view.slice(6)) : !n.body.archived)).filter(n => view !== 'notes' || visibilityFilter === 'all' || n.visibility === visibilityFilter).filter(matches).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  let pinned = $derived(visible.filter(n => n.body.pinned)), others = $derived(visible.filter(n => !n.body.pinned));
  const notify = (text: string) => toast = text;
  const synchronizer = createSync({ session: () => session, notes: () => notes, editor: () => editor, notify });

  let reactionRevision = $derived(notes.map(n => `${n.id}:${n.revision}:${n.body.trashed}`).sort().join(','));
  const emptyReactions = { likes: 0, replies: 0, liked: false };
  const notebookSocial = createNotebookSocial({ session: () => session, enabled: () => !isSocial || !!editor, revision: () => `${socialRevision}:${reactionRevision}` });

  $effect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('teum-dark', JSON.stringify(dark));
    if (Capacitor.isNativePlatform()) void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {});
  });
  $effect(() => { localStorage.setItem('teum-list', JSON.stringify(list)); });
  $effect(() => { if (!toast) return; const t = setTimeout(() => toast = '', 4500); return () => clearTimeout(t); });
  $effect(() => {
    const current = session;
    if (!current) { unread = 0; return; }
    let alive = true;
    const refresh = async () => {
      try { const data = await request<NotificationPage>('/social/notifications', current); if (alive) unread = data.unread; } catch { /* Keep the last confirmed badge on a transient failure. */ }
    };
    void refresh(); const timer = setInterval(refresh, 30000);
    return () => { alive = false; clearInterval(timer); };
  });
  onMount(() => {
    seed().catch(() => initError = '기기 저장소를 열지 못했어요. 브라우저의 저장 공간을 확인해 주세요.');
    fromLink();
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => {
      const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1);
      if (dialog) dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      else if (sidebar) sidebar = false;
      else if (view !== 'notes') navigate('notes');
      else void NativeApp.minimizeApp();
    });
    return () => { void listener.then(h => h.remove()); };
  });
  function shortcut(e: KeyboardEvent) { if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !document.querySelector('dialog[open]')) { e.preventDefault(); search?.focus(); } }
  function fromLink() {
    const params = new URLSearchParams(location.search);
    const legacyExplore = params.get('view') === 'explore';
    const next = (legacyExplore ? 'feed' : params.get('view')) as View;
    feedTab = legacyExplore || params.get('tab') === 'people' ? 'people' : 'posts';
    if (legacyExplore) { const url = new URL(location.href); url.searchParams.set('view', 'feed'); url.searchParams.set('tab', 'people'); history.replaceState(null, '', url); }
    readSequence++;
    view = next && (next === 'profile' || sections.some(s => s.view === next) || next.startsWith('label:')) ? next : session ? 'feed' : 'notes';
    targetProfile = params.get('profile') || '';
    if (view === 'profile' && (!targetProfile || targetProfile === session?.user.id)) { view = 'notes'; visibilityFilter = 'public'; }
    const id = params.get('note');
    if (id) void readPublic(id, false); else reader = null;
  }
  function closeReader() {
    readSequence++; reader = null; socialRevision++;
    const url = new URL(location.href); url.searchParams.delete('note'); history.replaceState(null, '', url);
  }
  async function navigate(next: View, profile = '') {
    readSequence++;
    scrollPositions.set(`${view}:${targetProfile}`, window.scrollY);
    view = next; targetProfile = profile; query = ''; reader = null;
    if (window.innerWidth <= 900) sidebar = false;
    const url = new URL(location.href); url.search = ''; url.searchParams.set('view', next);
    if (profile) url.searchParams.set('profile', profile);
    if (next === 'feed' && feedTab === 'people') url.searchParams.set('tab', 'people');
    history.pushState(null, '', url);
    restoreScroll = scrollPositions.get(`${next}:${profile}`) || 0;
    await tick(); window.scrollTo(0, restoreScroll);
  }
  function changeFeedTab(tab: 'posts' | 'people') {
    feedTab = tab;
    const url = new URL(location.href); url.searchParams.set('view', 'feed');
    if (tab === 'people') url.searchParams.set('tab', tab); else url.searchParams.delete('tab');
    history.replaceState(null, '', url);
  }
  function openProfile(id: string) { if (id === session?.user.id) { visibilityFilter = 'public'; void navigate('notes'); } else void navigate('profile', id); }
  async function socialReady() { await tick(); if (restoreScroll !== null) { window.scrollTo(0, restoreScroll); restoreScroll = null; } }
  function create(kind: Kind = 'text') { const note = newNote(scope, kind); if (view.startsWith('label:')) note.body.labels = [view.slice(6)]; editor = note; }
  async function save(note: LocalNote, body: NoteBody) { if (hasContent(body) || notes.some(n => n.id === note.id)) await persist(note, body); }
  async function update(note: LocalNote, patch: Partial<NoteBody>) {
    try { await persist(note, { ...note.body, ...patch }); if (patch.trashed !== undefined) notify(patch.trashed ? '메모를 휴지통으로 옮겼어요.' : '메모를 복원했어요.'); }
    catch { notify('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
  }
  async function open(note: LocalNote, discussion = false) {
    const release = holdEditor(note);
    try { editor = await db.notes.get([note.scope, note.id]) || note; reader = null; if (discussion) { await tick(); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-discussion]')?.scrollIntoView({ block: 'start' })); } }
    catch { release(); notify('메모 저장소를 열 수 없습니다.'); }
  }
  async function readPublic(id: string, push = true) {
    const current = session, ticket = ++readSequence;
    try {
      const result = await request<Post>(`/social/notes/${id}`, current);
      if (session?.token !== current?.token || ticket !== readSequence) return;
      if (result.note.author.id === current?.user.id) {
        let local = await db.notes.get([current.user.id, id]);
        if (!local) { const own = (await request<Note[]>('/notes', current)).find(n => n.id === id); if (own) local = { ...own, scope: current.user.id, dirty: false, mutationId: uid() }; }
        if (session?.token !== current.token || ticket !== readSequence) return;
        if (local) await open(local, true); else return;
      } else reader = result.note;
      if (push) { const url = new URL(location.href); url.searchParams.set('note', id); history.pushState(null, '', url); }
    } catch (e) { if (ticket === readSequence) { reader = null; notify(errorMessage(e)); } }
  }
  async function likeOwnNote(note: LocalNote) {
    if (!session) { authOpen = true; return; }
    const current = session;
    if (note.dirty) await sync(current);
    if (session?.token === current.token) await notebookSocial.like(note.id);
  }
  async function conversationFromCard(note: LocalNote) { await open(note, true); }
  function openFeedNote(id: string) {
    const note = notes.find(n => n.id === id);
    if (note) void open(note); else void readPublic(id);
  }
  async function syncDiscussion(note: LocalNote) {
    const current = session;
    if (!current) return;
    await sync(current);
    const latest = await db.notes.get([note.scope, note.id]);
    if (!latest || latest.dirty || latest.conflict || latest.syncError) throw new Error('메모 저장을 확인한 뒤 다시 시도해 주세요.');
  }
  function closeEditor() {
    editor = null; socialRevision++;
    const url = new URL(location.href); url.searchParams.delete('note'); history.replaceState(null, '', url);
  }
  async function fork(note: Note) {
    try { const current = await request<Note>(`/public/${note.id}`, session), next = newNote(scope); next.body = { ...current.body, pinned: false, archived: false, trashed: false, sourceId: current.id }; await persist(next, next.body); reader = null; navigate('notes'); editor = next; notify('내 비공개 메모로 복사했어요. 생각을 이어 써 보세요.'); }
    catch (e) { notify(errorMessage(e)); }
  }
  async function setVisibility(note: LocalNote, visibility: Visibility) {
    if (!session) throw new Error('먼저 로그인해 주세요.');
    await changeVisibility(note, visibility, session); socialRevision++;
    notify(visibility === 'public' ? '이 메모를 함께 볼 수 있어요.' : '이제 나만 볼 수 있어요.');
  }
  async function connect(next: Session, bring: boolean) {
    await account.connect(next, bring);
    editor = null; view = 'notes';
    notify('계정이 연결됐어요. 메모를 동기화합니다.');
  }
  async function logout() {
    await account.logout();
    view = 'notes'; accountOpen = false; reader = null; targetProfile = ''; unread = 0;
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), notes: notes.map(({ body, visibility, updatedAt, id }) => ({ id, body, visibility, updatedAt })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `notizfaden-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); notify('메모를 JSON 파일로 내보냈어요.');
  }
</script>

<svelte:window onkeydown={shortcut} onpopstate={fromLink}/>

{#snippet nav(items: typeof sections)}
  {#each items as item}
    <button class:selected={view === item.view || (item.view === 'notes' && view === 'profile' && (!targetProfile || targetProfile === session?.user.id))} onclick={() => navigate(item.view)} title={item.label}><item.icon size={22}/><span>{item.label}</span>{#if item.view === 'notifications' && unread}<span class="nav-new">{unread > 99 ? '99+' : unread}</span>{/if}</button>
  {/each}
{/snippet}
{#snippet cards(items: LocalNote[])}
  <div class="notes-grid" class:list>{#each items as note (note.id)}<NoteCard {note} author={notebookSocial.profile} onProfile={() => session ? openProfile(session.user.id) : authOpen = true} reactions={notebookSocial.reactions[note.id] || emptyReactions} onLike={() => likeOwnNote(note)} onConversation={() => conversationFromCard(note)} onOpen={() => open(note)} onChange={patch => update(note, patch)} onTag={label => navigate(`label:${label}`)}/>{/each}</div>
{/snippet}

<div class="app" class:sidebar-open={sidebar} class:sidebar-closed={!sidebar}>
  <header class="topbar">
    <div class="brand-area"><IconButton label="메뉴" icon={Menu} size={23} onclick={() => sidebar = !sidebar}/><a href="/" class="brand" aria-label="Notizfaden" onclick={e => { e.preventDefault(); navigate(session ? 'feed' : 'notes'); }}><img class="brand-icon" src="/icon.svg" alt=""/><span class="brand-name">Notizfaden</span></a></div>
    <div class="search"><Search size={21}/><input bind:this={search} type="search" aria-label="메모 검색" placeholder={view === 'feed' ? feedTab === 'people' ? '사람 검색' : '공개 메모 검색' : isSocial ? '사람과 공개 메모 검색' : '메모 검색'} bind:value={query}/>{#if query}<IconButton label="검색 지우기" icon={X} size={18} onclick={() => query = ''}/>{:else}<kbd>/</kbd>{/if}</div>
    <div class="top-actions">
      <button class="sync-status" onclick={() => synchronizer.run()} title={synchronizer.error || synchronizer.status} disabled={synchronizer.syncing || !!editor}>{#if synchronizer.syncing}<RefreshCw size={17} class="spin"/>{:else if synchronizer.error}<CloudOff size={18}/>{:else}<Cloud size={18}/>{/if}<span>{synchronizer.status}</span></button>
      <IconButton label={list ? '카드 보기' : '목록 보기'} icon={list ? LayoutGrid : Rows3} size={22} onclick={() => list = !list}/>
      <IconButton label={dark ? '밝은 테마' : '어두운 테마'} icon={dark ? Sun : Moon} size={21} onclick={() => dark = !dark}/>
      <button class="avatar" title={session ? '계정' : '로그인'} aria-label={session ? '계정' : '로그인'} onclick={() => session ? accountOpen = true : authOpen = true}>{session ? session.user.name[0].toUpperCase() : '나'}</button>
    </div>
  </header>
  {#if sidebar}<button class="drawer-shade" aria-label="메뉴 닫기" onclick={() => sidebar = false}></button>{/if}
  <aside class="sidebar"><nav aria-label="메모 탐색">
    {@render nav(sections.slice(0, 3))}<div class="nav-divider"></div><div class="nav-caption">라벨</div>
    {#each labels as label}<button class:selected={view === `label:${label}`} onclick={() => navigate(`label:${label}`)} title={label}><Tag size={20}/><span>{label}</span></button>{/each}
    <div class="nav-divider"></div>{@render nav(sections.slice(3))}
  </nav><div class="sidebar-footer"><span class="footer-mark">Notizfaden</span><p>나를 위해 적고,<br/>가끔은 함께.</p><button onclick={exportNotes}><Download size={14}/> 메모 내보내기</button></div></aside>
  <main>
    {#if $notebook.error || initError}<div class="banner error" role="alert">{$notebook.error || initError}</div>{/if}
    {#if synchronizer.error}<div class="banner" role="status"><CloudOff size={16}/>{synchronizer.error}<button onclick={() => synchronizer.run()}>다시 연결</button></div>{/if}
    <div class="workspace-head"><h1>{title}</h1><span>{isSocial ? '작은 메모에서 시작되는 우리 이야기.' : view === 'trash' ? '잠시 내려놓은 메모. 언제든 복원할 수 있어요.' : view === 'archive' ? '지금은 꺼내두지 않아도 되는 생각들.' : '떠오른 생각을 가볍게 남겨보세요.'}</span></div>
    {#if (!isSocial || (view === 'feed' && feedTab === 'posts')) && view !== 'trash' && view !== 'archive' && !query}<div class="composer"><button class="composer-input" onclick={() => create()}>메모 작성…</button><IconButton label="새 체크리스트" icon={CheckSquare} size={23} onclick={() => create('checklist')}/><IconButton label="새 메모" icon={Plus} size={24} onclick={() => create()}/></div>{/if}
    {#if view === 'notes' || ownProfile}<div class="note-filters" aria-label="메모 보기">
      {#each [{value: 'all', label: '전체'}, {value: 'public', label: '공개'}, {value: 'private', label: '비공개'}] as filter}
        <button class:selected={visibilityFilter === filter.value} aria-pressed={visibilityFilter === filter.value} onclick={() => visibilityFilter = filter.value as typeof visibilityFilter}>{filter.label}</button>
      {/each}
    </div>{/if}
    {#if view === 'notes' && visibilityFilter === 'public'}<SocialView view="profile" profileOnly profileId={session?.user.id || ''} {session} query="" {list} revision={socialRevision} onRead={readPublic} onOpenNote={openFeedNote} onProfile={openProfile} onLogin={() => authOpen = true} onUnread={value => unread = value} onReady={() => void notebookSocial.refresh()}/>{/if}
    {#if query}<p class="results">“{query}” 검색 결과</p>{/if}
    {#if isSocial}
      <SocialView {feedTab} onFeedTab={changeFeedTab} view={view as 'feed' | 'profile' | 'notifications'} profileId={targetProfile || session?.user.id || ''} {session} {query} {list} revision={socialRevision} onRead={readPublic} onOpenNote={openFeedNote} onProfile={openProfile} onLogin={() => authOpen = true} onUnread={value => unread = value} onReady={socialReady}/>
    {:else}
      {#if notebookSocial.error && session}<div class="social-status" role="status">메모 반응을 갱신하지 못했어요.<button onclick={() => notebookSocial.refresh()}>다시 시도</button></div>{/if}
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
  <nav class="bottom-nav" aria-label="주요 화면">{#each sections.slice(0, 3) as item}<button class:selected={view === item.view || (item.view === 'notes' && view === 'profile' && (!targetProfile || targetProfile === session?.user.id))} onclick={() => navigate(item.view)}><item.icon size={21}/><span>{item.label}</span>{#if item.view === 'notifications' && unread}<b>{unread > 99 ? '99+' : unread}</b>{/if}</button>{/each}</nav>
  <button class="mobile-create" aria-label="새 메모" onclick={() => create()}><Plus size={28}/></button>
  {#if editorCurrent}{#key editorCurrent.id}<Editor note={editorCurrent} onSync={syncDiscussion} onProfile={openProfile} onLogin={() => authOpen = true} onChanged={() => socialRevision++} onClose={closeEditor} onSave={save} onVisibility={setVisibility} {session} onSource={readPublic}/>{/key}{/if}
  {#if reader}<PublicReader note={reader} {session} onClose={closeReader} onFork={() => reader && fork(reader)} onProfile={openProfile} onLogin={() => authOpen = true} onChanged={() => socialRevision++}/>{/if}
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
  .social-status { display:flex; gap:12px; align-items:center; font-size:12px; color:var(--muted); margin:16px 0; } .social-status button { text-decoration:underline; min-height:40px; }

  .bottom-nav { display:none; }
  .note-filters { display:flex; align-items:center; gap:6px; margin:0 0 24px; padding-bottom:12px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  .note-filters button { padding:10px 22px; border-radius:22px; font-size:13px; min-height:44px; color:var(--muted); }
  .note-filters .selected { background:var(--selected); color:var(--fg); font-weight:500; }

  .topbar {
    height: calc(var(--app-header-height) + var(--app-safe-top));
    display: flex;
    align-items: center;
    padding: var(--app-safe-top) calc(24px + var(--app-safe-right)) 0 calc(12px + var(--app-safe-left));
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
    left: var(--app-safe-left);
    top: calc(var(--app-header-height) + var(--app-safe-top));
    bottom: 0;
    background: var(--bg);
    z-index: 15;
    padding: 20px 0 calc(20px + var(--app-safe-bottom));
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
    padding: calc(104px + var(--app-safe-top)) calc(36px + var(--app-safe-right)) calc(40px + var(--app-safe-bottom)) calc(36px + var(--app-safe-left));
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
    bottom: calc(28px + var(--app-safe-bottom));
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
      padding-left: calc(54px + var(--app-safe-left));
      padding-right: calc(54px + var(--app-safe-right));
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
      padding-right: calc(16px + var(--app-safe-right));
    }

    .brand-area {
      width: 234px;
    }

    .workspace-head > span {
      font-size: 11px;
    }

    main {
      padding-left: calc(24px + var(--app-safe-left));
      padding-right: calc(24px + var(--app-safe-right));
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
      inset: calc(var(--app-header-height) + var(--app-safe-top)) 0 0;
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
      padding: calc(100px + var(--app-safe-top)) calc(26px + var(--app-safe-right)) calc(40px + var(--app-safe-bottom)) calc(26px + var(--app-safe-left));
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
    .bottom-nav { display:flex; position:fixed; bottom:0; left:0; right:0; padding:7px var(--app-safe-right) calc(7px + var(--app-safe-bottom)) var(--app-safe-left); background:var(--bg); border-top:1px solid var(--line); z-index:13; }
    .bottom-nav button { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; min-height:48px; color:var(--muted); position:relative; font-size:10px; }
    .bottom-nav button.selected { color:var(--fg); background:var(--selected); border-radius:16px; }
    .bottom-nav b { position:absolute; top:0; right:16%; background:#b24c57; color:white; font-size:9px; border-radius:9px; padding:2px 5px; }

    .topbar {
      padding: var(--app-safe-top) calc(10px + var(--app-safe-right)) 0 calc(10px + var(--app-safe-left));
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

    main,
    .sidebar-closed main {
      padding: calc(89px + var(--app-safe-top)) calc(14px + var(--app-safe-right)) calc(160px + var(--app-safe-bottom)) calc(14px + var(--app-safe-left));
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

    .note-filters {
      margin-bottom: 18px;
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
      right: calc(24px + var(--app-safe-right));
      bottom: calc(90px + var(--app-safe-bottom));
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
      bottom: calc(155px + var(--app-safe-bottom));
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
