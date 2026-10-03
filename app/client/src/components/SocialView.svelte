<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { reorderable } from '../reorderable';
  import { masonry } from '../masonry';
  import { moveInOrder } from '../reordering';
  import { Compass, RefreshCw, Heart, MessageCircle, UserPlus, Bell } from '@lucide/svelte';
  import { ApiError, errorMessage, request } from '../api';
  import type { Session } from '../model';
  import { ago, avatarChoices, displayName, type Profile, type Post, type Page, type Notice, type NotificationPage, type Report } from '../social';
  import NoteCard from './NoteCard.svelte';
  import Person from './Person.svelte';
  import Modal from './Modal.svelte';
  let { view, feedTab = 'posts', onFeedTab = () => {}, profileId = '', profileOnly = false, session, query, list, revision = 0, onRead, onProfile, onLogin, onUnread, onReady, onOpenNote }: {
    view: 'feed' | 'profile' | 'notifications'; feedTab?: 'posts' | 'people'; onFeedTab?: (tab: 'posts' | 'people') => void; profileId?: string; profileOnly?: boolean; session: Session | null; query: string; list: boolean; revision?: number;
    onOpenNote: (id: string) => void;
    onRead: (id: string) => void; onProfile: (id: string) => void; onLogin: () => void; onUnread: (count: number) => void; onReady: () => void;
  } = $props();
  let followingOnly = $state(false), sort = $state<'latest' | 'top'>('latest');
  let following = $derived(!!session && followingOnly);
  let peopleTitle = $derived(query.trim() ? '사람 검색 결과' : following ? '내가 팔로우하는 사람들' : '최근 공개 메모를 쓴 사람들');
  let posts = $state.raw<Post[]>([]), people = $state.raw<Profile[]>([]), notices = $state.raw<Notice[]>([]);
  let profile = $state.raw<Profile | null>(null), connections = $state.raw<Profile[] | null>(null), connectionTitle = $state('');
  let cursor = $state<string | null>(null), noticeCursor = $state<number | null>(null), loading = $state(false), error = $state('');
  let editing = $state(false), display = $state(''), bio = $state(''), avatar = $state(''), busy = $state(false);
  let reporting = $state(false), reason = $state(''), message = $state('');
  let adminReports = $state.raw<Report[] | null>(null), adminOpen = $state(false);
  const identity = () => `${session?.token || ''}:${view}:${profileId}`;
  let contextKey = $state('');
  let temporaryOrder = $state<string[]>([]), hasNewPosts = $state(false), feedLoaded = $state(false);
  let orderedPosts = $derived.by(() => {
    const byId = new Map(posts.map(post => [post.note.id, post]));
    const arranged = temporaryOrder.flatMap(id => { const post = byId.get(id); byId.delete(id); return post ? [post] : []; });
    return [...arranged, ...byId.values()];
  });
  async function movePost(id: string, target: string, path?: string[]) {
    const ids = orderedPosts.map(post => post.note.id);
    if (id === target || !ids.includes(id) || !ids.includes(target)) return false;
    const next = moveInOrder(ids, id, target, path);
    if (next.join() === ids.join()) return false;
    temporaryOrder = next;
    return true;
  }
  let serial = 0, touchStart: number | null = null, pull = $state(0);
  const endpoint = (path: string, method = 'GET', body?: unknown) => request<any>(`/social${path}`, session, method, body);
  $effect(() => {
    const key = `${identity()}:${query}:${feedTab}:${following}:${sort}`; revision;
    const sameContext = untrack(() => contextKey === key);
    untrack(() => { if (sameContext) return; contextKey = key; temporaryOrder = []; hasNewPosts = false; feedLoaded = false; posts = []; people = []; notices = []; profile = null; cursor = null; noticeCursor = null; error = ''; connections = null; editing = false; reporting = false; adminOpen = false; adminReports = null; message = ''; reason = ''; busy = false; loading = true; });
    const background = sameContext && view === 'feed' && feedTab === 'posts' && untrack(() => feedLoaded);
    const timer = setTimeout(() => void load(false, background), 180);
    return () => { clearTimeout(timer); serial++; };
  });
  // Check for arrivals without inserting them into the current reading session.
  $effect(() => {
    if (view !== 'feed' || feedTab !== 'posts') return;
    const timer = setInterval(() => { if (!document.hidden && !loading && feedLoaded) void load(false, true); }, 30000);
    return () => clearInterval(timer);
  });
  async function load(more = false, background = false) {
    const ticket = ++serial, visibleCount = posts.length;
    if (!background) { loading = true; error = ''; }
    try {
      if (view === 'notifications') {
        if (!session) { notices = []; return; }
        const data: NotificationPage = await endpoint(`/notifications${more && noticeCursor ? `?cursor=${noticeCursor}` : ''}`);
        if (ticket !== serial) return;
        notices = more ? [...notices, ...data.items.filter(n => !notices.some(old => old.id === n.id))] : data.items; noticeCursor = data.cursor; onUnread(data.unread);
      } else if (view === 'profile') {
        if (!profileId) return;
        const person: Profile = await endpoint(`/profiles/${profileId}`);
        if (ticket !== serial) return;
        profile = person;
        if (!profileOnly) { const data: Page<Post> = await endpoint(`/feed?author=${profileId}${more && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); if (ticket !== serial) return; posts = more ? [...posts, ...data.items] : data.items; cursor = data.cursor; }
        if (person.id === session?.user.id) {
          try { const reports: Report[] = await endpoint('/admin/reports'); if (ticket === serial) adminReports = reports; } catch { /* Regular accounts have no moderation queue. */ }
        }
      } else {
        const params = new URLSearchParams();
        if (following) params.set('following', 'true');
        if (query.trim()) params.set('q', query.trim());
        if (more && cursor) params.set('cursor', cursor);
        if (feedTab === 'people') {
          const users: Profile[] = await endpoint(`/people?${params}`);
          if (ticket === serial) { people = users; posts = []; cursor = null; }
          return;
        }
        params.set('sort', sort);
        const data: Page<Post> = await endpoint(`/feed?${params}`);
        if (ticket !== serial) return;
        while (!more && data.cursor && data.items.length < visibleCount) {
          params.set('cursor', data.cursor);
          const next: Page<Post> = await endpoint(`/feed?${params}`);
          if (ticket !== serial) return;
          data.items.push(...next.items); data.cursor = next.cursor;
        }
        if (ticket !== serial) return;
        if (background) {
          const updated = new Map<string, Post | null>(data.items.map(post => [post.note.id, post]));
          // Arrivals may push an existing card past the fetched page boundary.
          // Verify missing cards individually instead of mistaking that for deletion.
          await Promise.all(posts.filter(post => !updated.has(post.note.id)).map(async post => {
            try { updated.set(post.note.id, await endpoint(`/notes/${post.note.id}`)); }
            catch (e) { updated.set(post.note.id, e instanceof ApiError && [403, 404].includes(e.status) ? null : post); }
          }));
          if (ticket !== serial) return;
          hasNewPosts = data.items.some(post => !posts.some(old => old.note.id === post.note.id));
          // Keep the baseline order as well as the temporary arrangement.
          // Removed/private posts disappear; existing reactions can update.
          posts = posts.flatMap(post => { const next = updated.get(post.note.id); return next ? [next] : []; });
        } else {
          posts = more ? [...posts, ...data.items.filter(p => !posts.some(old => old.note.id === p.note.id))] : data.items;
          cursor = data.cursor;
          if (!more) { temporaryOrder = []; hasNewPosts = false; feedLoaded = true; }
        }
      }
    } catch (e) { if (ticket === serial && !background) error = errorMessage(e); }
    finally { if (ticket === serial) { loading = false; await tick(); onReady(); } }
  }
  async function like(p: Post) {
    if (!session) { onLogin(); return; }
    const token = session.token; error = '';
    try { const updated: Post = await endpoint(`/notes/${p.note.id}/like`, 'PUT', { enabled: !p.liked }); if (session?.token === token) posts = posts.map(item => item.note.id === p.note.id ? updated : item); }
    catch (e) { error = errorMessage(e); }
  }
  async function relate(kind: 'follow' | 'block' | 'mute', enabled: boolean) {
    if (!session) { onLogin(); return; }
    if (!profile || busy) return;
    const context = identity(); busy = true; error = '';
    try { await endpoint(`/profiles/${profile.id}/${kind}`, 'PUT', { enabled }); if (identity() === context) await load(); }
    catch (e) { if (identity() === context) error = errorMessage(e); } finally { if (identity() === context) busy = false; }
  }
  function edit() { if (!profile) return; display = profile.displayName; bio = profile.bio; avatar = profile.avatar; editing = true; }
  async function saveProfile(e: SubmitEvent) {
    e.preventDefault(); const context = identity(); busy = true; error = '';
    try { await endpoint('/profile', 'PUT', { displayName: display, bio, avatar }); if (identity() === context) { editing = false; await load(); } }
    catch (e) { if (identity() === context) error = errorMessage(e); } finally { if (identity() === context) busy = false; }
  }
  async function showConnections(kind: 'following' | 'followers') {
    if (!profile) return;
    const context = identity();
    try { const result: Profile[] = await endpoint(`/profiles/${profile.id}/connections?kind=${kind}`); if (identity() === context) { connections = result; connectionTitle = kind === 'following' ? '팔로잉' : '팔로워'; } }
    catch (e) { if (identity() === context) error = errorMessage(e); }
  }
  async function markRead() {
    if (!notices.length) return;
    const context = identity();
    try { await endpoint(`/notifications/${Math.max(...notices.map(n => n.id))}`, 'PUT'); if (identity() !== context) return; notices = notices.map(n => ({ ...n, read: true })); const data: NotificationPage = await endpoint('/notifications'); if (identity() === context) onUnread(data.unread); }
    catch (e) { if (identity() === context) error = errorMessage(e); }
  }
  async function openNotice(n: Notice) { const context = identity(); if (!n.read) await markRead(); if (identity() !== context) return; if (n.noteId) onRead(n.noteId); else onProfile(n.profile.id); }
  async function submitReport(e: SubmitEvent) {
    e.preventDefault(); if (!session || !profile || busy) return; const context = identity(); busy = true;
    try { await endpoint(`/profiles/${profile.id}/report`, 'POST', { reason }); if (identity() === context) { reporting = false; reason = ''; message = '신고가 접수됐어요.'; } }
    catch (e) { if (identity() === context) error = errorMessage(e); } finally { if (identity() === context) busy = false; }
  }
  async function resolve(report: Report) {
    const context = identity();
    try { await endpoint(`/admin/reports/${report.id}`, 'PUT', { enabled: !report.resolved }); if (identity() !== context) return; const rows: Report[] = await endpoint('/admin/reports'); if (identity() === context) adminReports = rows; }
    catch (e) { if (identity() === context) error = errorMessage(e); }
  }
  function startTouch(e: TouchEvent) { touchStart = e.touches.length === 1 && window.scrollY < 5 ? e.touches[0].clientY : null; }
  function moveTouch(e: TouchEvent) { if (e.defaultPrevented) { touchStart = null; pull = 0; return; } if (touchStart !== null) pull = Math.max(0, e.touches[0].clientY - touchStart); }
  function endTouch() { if (pull > 90 && !loading) void load(); touchStart = null; pull = 0; }
</script>
<svelte:window ontouchstart={startTouch} ontouchmove={moveTouch} ontouchend={endTouch}/>
<section class="social-view" aria-label={view === 'notifications' ? '알림 목록' : '소셜 메모'}>
  {#if pull > 50}<p class="hint">{pull > 90 ? '놓으면 새로고침해요' : '조금 더 당겨주세요'}</p>{/if}
  {#if view === 'feed'}
    <div class="social-tabs" aria-label="피드 보기">
      <button class:selected={feedTab === 'posts'} aria-pressed={feedTab === 'posts'} onclick={() => onFeedTab('posts')}>게시물</button>
      <button class:selected={feedTab === 'people'} aria-pressed={feedTab === 'people'} onclick={() => onFeedTab('people')}>사람들</button>
      <button class="refresh" aria-label="피드 새로고침" disabled={loading} onclick={() => load()}><RefreshCw size={17} class={loading ? 'spin' : ''}/></button>
    </div>
    <div class="feed-filters">
      <button class="following-toggle" role="switch" aria-checked={following} onclick={() => { if (!session) onLogin(); else followingOnly = !followingOnly; }}><span class="toggle-track" class:on={following}></span>팔로잉만</button>
      {#if feedTab === 'posts'}<label class="feed-sort"><span class="sr-only">게시물 정렬</span><select aria-label="게시물 정렬" bind:value={sort}><option value="latest">최신순</option><option value="top">인기순</option></select></label>{/if}
    </div>
    {#if feedTab === 'posts' && sort === 'top'}<details class="ranking-info"><summary>최근 7일 · 반응한 사람 순</summary><p>최근 7일에 게시된 메모 중 좋아요나 댓글을 남긴 사람이 많은 순서예요. 작성자 본인과 차단·뮤트한 사람은 제외하고, 같은 사람의 반응은 한 번만 셉니다. 동률이면 최신 게시물이 먼저 나와요.</p></details>{/if}
    {#if feedTab === 'people'}
      <h2 class="section-title">{peopleTitle}</h2>
      <div class="people-grid">{#each people as person (person.id)}<Person {person} onOpen={() => onProfile(person.id)}/>{/each}</div>
      {#if !loading && !error && !people.length}<div class="social-empty"><UserPlus size={38}/><h2>{query.trim() ? '검색한 사람을 찾지 못했어요' : following ? '아직 팔로우한 사람이 없어요' : '아직 공개 메모를 쓴 다른 사람이 없어요'}</h2><p>{following ? '팔로잉만을 끄고 새로운 사람을 찾아보세요.' : '이름으로 검색해 보세요.'}</p></div>{/if}
    {/if}
  {:else if view === 'profile'}
    {#if profile}
      <div class="profile-head">
        <span class="avatar profile-avatar">{profile.avatar || displayName(profile)[0]}</span>
        <div class="profile-info"><h2>{displayName(profile)}</h2><p class="handle">@{profile.name}</p><p class="bio">{profile.bio || '작은 생각을 모으는 중이에요.'}</p>
          <div class="metrics"><button onclick={() => showConnections('followers')}>팔로워 <b>{profile.followers}</b></button><button onclick={() => showConnections('following')}>팔로잉 <b>{profile.followingCount}</b></button></div>
        </div>
        {#if session?.user.id === profile.id}<button class="pill" onclick={edit}>프로필 편집</button>
        {:else}<div class="profile-actions">
          {#if !profile.blocked && !profile.blockedBy}<button class="pill" class:active={profile.following} disabled={busy} onclick={() => relate('follow', !profile!.following)}>{profile.following ? '팔로잉 · 해제' : '팔로우'}</button>{/if}
          <details><summary aria-label="사용자 메뉴">···</summary><div class="menu"><button onclick={() => relate('mute', !profile!.muted)}>{profile.muted ? '뮤트 해제' : '뮤트'}</button><button onclick={() => relate('block', !profile!.blocked)}>{profile.blocked ? '차단 해제' : '차단'}</button><button onclick={() => { if (!session) onLogin(); else reporting = true; }}>신고</button></div></details>
        </div>{/if}
      </div>
      {#if profile.blocked || profile.blockedBy}<p class="hint">차단된 관계에서는 메모를 읽거나 대화할 수 없어요.</p>{:else if profile.muted}<p class="hint">뮤트한 사람의 메모와 알림을 숨기고 있어요.</p>{/if}
      {#if adminReports !== null}<button class="text-button" onclick={() => adminOpen = !adminOpen}>관리자 신고함 ({adminReports.filter(r => !r.resolved).length})</button>{/if}
      {#if adminOpen && adminReports}{#each adminReports as report (report.id)}<div class="report"><button class="text-button" onclick={() => onProfile(report.targetId)}>@{report.targetName}</button><p>{report.reason}</p>{#if report.noteId}<button class="text-button" onclick={() => onRead(report.noteId!)}>메모 보기</button>{/if}<button class="text-button" onclick={() => resolve(report)}>{report.resolved ? '다시 열기' : '검토 완료'}</button></div>{/each}{/if}
    {:else if !profileId}<div class="social-empty"><UserPlus size={35}/><h2>나의 생각을 소개해 보세요</h2><button class="pill" onclick={onLogin}>로그인</button></div>{/if}
  {:else}
    <div class="section-top"><h2>내 생각에 도착한 소식</h2><div><button class="text-button" onclick={markRead} disabled={!notices.some(n => !n.read)}>모두 읽음</button><button class="text-button" disabled={loading} onclick={() => load()}>새로고침</button></div></div>
    {#if !session}<div class="social-empty"><Bell size={35}/><p>로그인하면 새로운 소식을 받을 수 있어요.</p><button class="pill" onclick={onLogin}>로그인</button></div>{/if}
    <div class="notices">{#each notices as n (n.id)}<button class="notice" class:unread={!n.read} onclick={() => openNotice(n)}>
      <span class="notice-icon">{#if n.kind === 'follow'}<UserPlus size={20}/>{:else if n.kind === 'like'}<Heart size={20}/>{:else}<MessageCircle size={20}/>{/if}</span>
      <span><strong>{displayName(n.profile)}</strong>{n.kind === 'follow' ? '님이 나를 팔로우했어요.' : n.kind === 'like' ? '님이 내 메모를 좋아해요.' : '님이 내 메모에 답글을 남겼어요.'}<small>{ago(n.createdAt)}</small></span>{#if !n.read}<i aria-label="읽지 않음"></i>{/if}
    </button>{/each}</div>
    {#if session && !loading && !notices.length}<div class="social-empty"><Bell size={35}/><p>새로운 소식이 여기에 모여요.</p></div>{/if}
    {#if noticeCursor}<button class="load-more" disabled={loading} onclick={() => load(true)}>이전 알림 더 보기</button>{/if}
  {/if}
  {#if error}<div class="error" role="alert">{error}<button onclick={() => load()}>다시 시도</button></div>{/if}
  {#if message}<p class="hint" role="status">{message}</p>{/if}
  {#if (view === 'feed' && feedTab === 'posts') || (view === 'profile' && !profileOnly)}
    {#if view === 'feed'}<div class="feed-arrangement">{#if temporaryOrder.length}<span role="status">임시 배치</span><button class="text-button" onclick={() => temporaryOrder = []}>원래 순서로</button>{/if}{#if hasNewPosts}<button class="text-button new-posts" disabled={loading} onclick={() => load()}>새 글 보기</button>{/if}</div>{/if}
    <div class="social-grid" class:list use:masonry use:reorderable={{ enabled: view === 'feed' && feedTab === 'posts', context: `${contextKey}:${list}`, ids: orderedPosts.map(post => post.note.id), onMove: movePost }}>{#each orderedPosts as post (post.note.id)}<NoteCard note={post.note} canReorder={view === 'feed' && orderedPosts.length > 1} own={false} author={post.profile} testId="social-card" reactions={post} onOpen={() => onOpenNote(post.note.id)} onProfile={() => onProfile(post.profile.id)} onLike={() => like(post)} onConversation={() => onRead(post.note.id)}/>{/each}</div>
    {#if cursor}<button class="load-more" disabled={loading} onclick={() => load(true)}>{loading ? '불러오는 중…' : '메모 더 보기'}</button>{/if}
    {#if !loading && !error && !posts.length}<div class="social-empty"><Compass size={38}/><h2>{query.trim() && view !== 'profile' ? '검색한 공개 메모를 찾지 못했어요' : following && view === 'feed' ? '팔로우로 메모장을 연결해 보세요' : view === 'feed' && sort === 'top' ? '최근 7일에 공개된 메모가 없어요' : '아직 공개된 메모가 없어요'}</h2><p>{query.trim() && view !== 'profile' ? '다른 단어나 이름으로 검색해 보세요.' : view === 'feed' && sort === 'top' ? '최신순으로 바꾸면 이전 메모도 볼 수 있어요.' : '사람들에서 팔로우하거나, 내 메모를 공개해 보세요.'}</p></div>{/if}
  {/if}
  {#if loading}<p class="hint" role="status">생각을 불러오고 있어요…</p>{/if}
</section>
{#if connections !== null}<Modal label={connectionTitle} onClose={() => connections = null} class="account-dialog"><div class="section-top"><h2>{connectionTitle}</h2><button class="text-button" onclick={() => connections = null}>닫기</button></div>{#each connections as person (person.id)}<Person {person} onOpen={() => { connections = null; onProfile(person.id); }}/>{/each}{#if !connections.length}<p>아직 연결된 사람이 없어요.</p>{/if}</Modal>{/if}
{#if editing}<Modal label="프로필 편집" onClose={() => { if (!busy) editing = false; }} class="account-dialog"><form class="social-form" onsubmit={saveProfile}><h2>나를 소개해요</h2><div class="avatar-choices">{#each avatarChoices as value}<button type="button" class:selected={avatar === value} aria-label={value || '이름 아바타'} onclick={() => avatar = value}>{value || profile?.name[0].toUpperCase()}</button>{/each}</div><label>표시 이름<input maxlength={40} bind:value={display}/></label><label>소개<textarea maxlength={300} rows={4} bind:value={bio}></textarea></label>{#if error}<p class="error" role="alert">{error}</p>{/if}<div class="section-top"><button type="button" class="text-button" disabled={busy} onclick={() => editing = false}>취소</button><button class="pill" disabled={busy}>저장</button></div></form></Modal>{/if}
{#if reporting}<Modal label="사용자 신고" onClose={() => reporting = false} class="account-dialog"><form class="social-form" onsubmit={submitReport}><h2>신고하기</h2><label>신고 사유<textarea required maxlength={1000} rows={4} bind:value={reason}></textarea></label>{#if error}<p class="error" role="alert">{error}</p>{/if}<div class="section-top"><button type="button" class="text-button" onclick={() => reporting = false}>취소</button><button class="pill" disabled={busy}>신고 접수</button></div></form></Modal>{/if}
<style>
  .feed-arrangement { display:flex; align-items:center; gap:8px; min-height:36px; margin:-8px 0 16px; font-size:12px; color:var(--muted); }
  .feed-arrangement .new-posts { margin-left:auto; }
  .social-tabs { display:flex; gap:6px; align-items:center; margin:0 0 14px; border-bottom:1px solid var(--line); padding-bottom:12px; }
  .social-tabs button { padding:10px 22px; font-size:13px; border-radius:22px; color:var(--muted); min-height:44px; }
  .social-tabs button.selected { background:var(--selected); color:var(--fg); font-weight:500; } .social-tabs .refresh { margin-left:auto; padding:10px; display:flex; }
  .feed-filters { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
  .following-toggle { display:flex; align-items:center; gap:10px; min-height:44px; font-size:13px; color:var(--muted); }
  .following-toggle[aria-checked="true"] { color:var(--fg); }
  .toggle-track { width:32px; height:20px; padding:3px; border-radius:20px; background:var(--line); }
  .toggle-track::after { content:''; display:block; width:14px; height:14px; border-radius:50%; background:var(--muted); transition:transform .15s; }
  .toggle-track.on { background:var(--selected); } .toggle-track.on::after { transform:translateX(12px); background:var(--fg); }
  .feed-sort select { min-height:44px; padding:8px 12px; border:1px solid var(--line); border-radius:20px; background:var(--bg); color:var(--fg); font:inherit; font-size:13px; cursor:pointer; }
  .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
  .ranking-info { position:static; margin:-8px 0 24px; font-size:12px; color:var(--muted); }
  .ranking-info summary { font-size:12px; padding:0; min-height:28px; list-style:disclosure-closed; }
  .ranking-info p { max-width:560px; line-height:1.8; padding-top:8px; }
  .social-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,232px),1fr)); grid-auto-rows:1px; align-items:start; column-gap:16px; } .social-grid.list { grid-template-columns:minmax(0,1fr); max-width:600px; margin:auto; }
  .people-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; margin-bottom:30px; }
  .section-top { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:18px; } h2 { font-size:17px; font-weight:500; } .section-title { font-size:13px; color:var(--muted); margin:24px 0 18px; }
  .social-empty { min-height:240px; display:flex; align-items:center; justify-content:center; flex-direction:column; text-align:center; gap:14px; color:var(--muted); padding:30px 10px; } .social-empty h2 { font-size:16px; } .social-empty p,.hint { font-size:12px; line-height:1.8; color:var(--muted); } .hint { text-align:center; padding:15px; }
  .load-more { display:block; margin:24px auto; padding:12px 28px; border:1px solid var(--line); border-radius:24px; font-size:13px; }
  .profile-head { display:flex; align-items:flex-start; gap:18px; padding:12px 0 24px; margin-bottom:24px; border-bottom:1px solid var(--line); } .profile-avatar { width:64px; height:64px; font-size:30px; margin:0; } .profile-info { flex:1; min-width:0; } .profile-info h2 { font-size:23px; overflow-wrap:anywhere; } .handle { font-size:12px; color:var(--muted); margin:5px 0 14px; } .bio { font-size:13px; line-height:1.8; white-space:pre-wrap; overflow-wrap:anywhere; }
  .metrics { display:flex; flex-wrap:wrap; gap:12px; align-items:center; font-size:12px; color:var(--muted); margin-top:12px; } .metrics button { padding:8px 0; } b { color:var(--fg); }
  .pill { border:1px solid var(--line); border-radius:22px; padding:10px 18px; font-size:12px; min-height:44px; white-space:nowrap; } .pill:hover,.pill.active { background:var(--selected); } .profile-actions { display:flex; gap:6px; align-items:center; }
  details { position:relative; } summary { list-style:none; cursor:pointer; padding:10px; font-size:20px; } .menu { position:absolute; right:0; top:100%; min-width:140px; background:var(--bg); border:1px solid var(--line); border-radius:8px; z-index:5; box-shadow:var(--shadow); padding:5px; } .menu button { display:block; padding:12px; width:100%; text-align:left; font-size:13px; }
  .notices { max-width:800px; margin:auto; } .notice { display:flex; align-items:center; gap:14px; padding:20px; border:1px solid var(--line); border-radius:9px; margin-bottom:10px; width:100%; text-align:left; font-size:13px; line-height:1.8; } .notice.unread { background:var(--selected); } .notice-icon { color:#677c69; } .notice small { display:block; color:var(--muted); font-size:11px; } .notice strong { margin-right:2px; } .notice i { width:7px; height:7px; border-radius:50%; background:#4b5f88; margin-left:auto; flex-shrink:0; }
  .social-form { display:grid; gap:18px; } .social-form label { display:grid; gap:8px; font-size:13px; } .social-form input,.social-form textarea { padding:12px; border:1px solid var(--line); background:var(--bg); border-radius:7px; width:100%; resize:vertical; } .avatar-choices { display:flex; flex-wrap:wrap; gap:5px; } .avatar-choices button { width:44px; height:44px; border-radius:50%; font-size:23px; } .avatar-choices .selected { background:var(--selected); outline:2px solid #78927f; } .report { border:1px solid var(--line); border-radius:8px; padding:12px; margin:12px 0; font-size:13px; } .report p { white-space:pre-wrap; overflow-wrap:anywhere; }
  @media(max-width:600px) { .social-grid { grid-template-columns:repeat(2,minmax(0,1fr)); column-gap:10px; } .social-tabs { margin-bottom:18px; } .profile-head { gap:12px; flex-wrap:wrap; } .profile-avatar { width:48px; height:48px; font-size:24px; } .profile-info h2 { font-size:19px; } .profile-actions { margin-left:auto; } .section-top h2 { font-size:14px; } .section-top .text-button { font-size:11px; padding:8px; } }
  @media(max-width:360px) { .social-grid { grid-template-columns:minmax(0,1fr); } }
</style>
