<script lang="ts">
  import { untrack } from 'svelte';
  import { Copy, X, Heart, MessageCircle, Trash2, Share2 } from '@lucide/svelte';
  import { noteStyle, uid, type Note, type Session } from '../model';
  import { request, errorMessage, ApiError } from '../api';
  import { ago, displayName, type Post, type Reply, type Page } from '../social';
  import IconButton from './IconButton.svelte';
  import Modal from './Modal.svelte';
  import RichTextView from './RichTextView.svelte';
  let { note, session, onClose, onFork, onProfile, onLogin, onChanged }: { note: Note; session: Session | null; onClose: () => void; onFork: () => void; onProfile: (id: string) => void; onLogin: () => void; onChanged: () => void } = $props();
  let post = $state.raw<Post | null>(null), replies = $state.raw<Reply[]>([]), cursor = $state<string | null>(null);
  let content = $state(''), pending: { id: string; content: string } | null = null;
  let busy = $state(false), liking = $state(false), loading = $state(false), error = $state(''), unavailable = $state(false), copied = $state(false);
  let reporting = $state(false), reason = $state(''), reported = $state(false), deleting = $state('');
  let sequence = 0;
  $effect(() => {
    note.id; session?.token;
    untrack(() => { post = null; replies = []; cursor = null; unavailable = false; content = ''; pending = null; reporting = false; reported = false; reason = ''; });
    void untrack(() => load());
    const timer = setInterval(() => { if (!loading && !busy && !liking && !deleting) void load(); }, 15000);
    return () => { sequence++; clearInterval(timer); };
  });
  async function load(more = false) {
    const ticket = ++sequence, visibleCount = replies.length; loading = true;
    try {
      const [p, data] = await Promise.all([
        request<Post>(`/social/notes/${note.id}`, session),
        request<Page<Reply>>(`/social/notes/${note.id}/replies${more && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, session)
      ]);
      // Revalidate all visible pages, including deletions, without collapsing a long thread.
      while (!more && data.cursor && data.items.length < visibleCount) {
        const next = await request<Page<Reply>>(`/social/notes/${note.id}/replies?cursor=${encodeURIComponent(data.cursor)}`, session);
        if (ticket !== sequence) return;
        data.items.push(...next.items); data.cursor = next.cursor;
      }
      if (ticket !== sequence) return;
      post = p; unavailable = false; error = '';
      if (more) { replies = [...replies, ...data.items.filter(r => !replies.some(old => old.id === r.id))]; cursor = data.cursor; }
      else { replies = data.items; cursor = data.cursor; }
    } catch (e) {
      if (ticket !== sequence) return;
      if (e instanceof ApiError && [403,404].includes(e.status)) { unavailable = true; post = null; replies = []; }
      error = errorMessage(e);
    } finally { if (ticket === sequence) loading = false; }
  }
  async function like() {
    if (!session) { onLogin(); return; }
    if (!post || liking) return; liking = true;
    try { post = await request<Post>(`/social/notes/${note.id}/like`, session, 'PUT', { enabled: !post.liked }); onChanged(); }
    catch (e) { error = errorMessage(e); } finally { liking = false; }
  }
  async function submit(e: SubmitEvent) {
    e.preventDefault(); if (!session) { onLogin(); return; }
    if (busy || !content.trim()) return; busy = true; error = '';
    if (!pending || pending.content !== content.trim()) pending = { id: uid(), content: content.trim() };
    try { await request(`/social/notes/${note.id}/replies`, session, 'POST', pending); content = ''; pending = null; await load(); onChanged(); }
    catch (e) { error = errorMessage(e); } finally { busy = false; }
  }
  async function remove(reply: Reply) {
    if (deleting) return; deleting = reply.id;
    try { await request(`/social/notes/${note.id}/replies/${reply.id}`, session, 'DELETE'); await load(); onChanged(); }
    catch (e) { error = errorMessage(e); } finally { deleting = ''; }
  }
  async function share() {
    const base = import.meta.env.VITE_PUBLIC_URL || location.origin;
    try { await navigator.clipboard.writeText(`${base}/?note=${note.id}`); copied = true; } catch { error = '링크를 복사하지 못했어요.'; }
  }
  async function report(e: SubmitEvent) {
    e.preventDefault(); if (!session) { onLogin(); return; } busy = true;
    try { await request(`/social/profiles/${note.author.id}/report`, session, 'POST', { reason, noteId: note.id }); reporting = false; reported = true; }
    catch (e) { error = errorMessage(e); } finally { busy = false; }
  }
</script>
<Modal label="공개 메모" {onClose} class="editor-dialog">
  <div class="reader" style={noteStyle((post?.note || note).body.color)}>
    <div class="reader-head"><button class="author" onclick={() => onProfile(note.author.id)}><span class="avatar tiny">{post?.profile.avatar || note.author.name[0].toUpperCase()}</span>{post ? displayName(post.profile) : note.author.name}</button><IconButton label="닫기" icon={X} onclick={onClose}/></div>
    {#if unavailable}<div class="error" role="alert">이 메모는 더 이상 열람할 수 없어요.</div>
    {:else}
      {@const current = post?.note || note}
      <h2>{current.body.title}</h2>
      {#if post}<p class="reader-time">{ago(post.publishedAt)} · 전체 공개</p>{/if}
      {#if current.body.kind === 'checklist'}{#each current.body.items as item}<p class:completed={item.done}>{item.done ? '☑' : '☐'} {item.text}</p>{/each}
      {:else}<div class="reader-content"><RichTextView text={current.body.content} richText={current.body.richText}/></div>{/if}
      <div class="reader-actions"><button class:liked={post?.liked} aria-label={post?.liked ? '좋아요 취소' : '좋아요'} aria-pressed={post?.liked || false} disabled={liking || !post} onclick={like}><Heart size={19} fill={post?.liked ? 'currentColor' : 'none'}/>{post?.likes || 0}</button><span><MessageCircle size={19}/>{post?.replies || 0}</span><button onclick={share}><Share2 size={17}/>{copied ? '복사됨' : '링크'}</button><button class="text-button" onclick={onFork}><Copy size={16}/> 내 메모로 이어 쓰기</button></div>
      <section class="conversation" aria-label="답글"><div class="conversation-heading"><h3>함께 나누는 생각</h3><button class="text-button" disabled={loading} onclick={() => load()}>새로고침</button></div>
        {#each replies as r (r.id)}<article class="reply" data-testid="reply"><div class="reply-head"><button class="author" onclick={() => onProfile(r.profile.id)}><span class="avatar tiny">{r.profile.avatar || displayName(r.profile)[0]}</span>{displayName(r.profile)}</button><time>{ago(r.createdAt)}</time>{#if session?.user.id === r.profile.id || session?.user.id === note.author.id}<IconButton label="답글 삭제" icon={Trash2} size={15} disabled={!!deleting} onclick={() => remove(r)}/>{/if}</div><p>{r.content}</p></article>{/each}
        {#if cursor}<button class="text-button" disabled={loading} onclick={() => load(true)}>답글 더 보기</button>{/if}
        {#if !replies.length && !loading}<p class="hint">첫 번째 답글을 남겨보세요.</p>{/if}
        {#if session}<form class="reply-form" onsubmit={submit}><textarea aria-label="답글" placeholder="생각을 나눠보세요…" maxlength={3000} rows={2} bind:value={content} disabled={busy}></textarea><button class="text-button" disabled={busy || !content.trim()}>{busy ? '보내는 중…' : '답글 보내기'}</button></form>
        {:else}<button class="text-button" onclick={onLogin}>로그인하고 대화에 참여하기</button>{/if}
      </section>
      {#if session && session.user.id !== note.author.id}<button class="report-link" onclick={() => reporting = !reporting}>이 메모 신고</button>{/if}
      {#if reporting}<form class="reply-form" onsubmit={report}><textarea aria-label="신고 사유" required maxlength={1000} bind:value={reason} placeholder="신고 사유를 알려주세요"></textarea><button class="text-button" disabled={busy}>신고 접수</button></form>{/if}
      {#if reported}<p class="hint" role="status">신고가 접수됐어요.</p>{/if}
    {/if}
    {#if error && !unavailable}<div class="error" role="alert">{error}<button onclick={() => load()}>다시 시도</button></div>{/if}
  </div>
</Modal>
<style>
  .reader { padding:18px 24px 24px; background:var(--card-light); color:#202124; }
  :global([data-theme=dark]) .reader { background:var(--card-dark); color:var(--fg); }
  .reader-head,.reader-actions,.reply-head,.conversation-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  h2 { font-size:21px; line-height:1.6; margin:10px 0 5px; overflow-wrap:anywhere; } .reader-time { font-size:11px; opacity:.6; margin-bottom:22px; }
  .reader-content { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.9; font-size:15px; min-height:100px; } .completed { text-decoration:line-through; opacity:.65; }
  .reader-actions { border-top:1px solid #8883; margin-top:28px; padding-top:10px; justify-content:flex-start; flex-wrap:wrap; font-size:12px; }
  .reader-actions button,.reader-actions > span { display:flex; align-items:center; gap:7px; min-height:44px; padding:8px; } .reader-actions .text-button { margin-left:auto; } .liked { color:#c44261; }
  .conversation { margin-top:24px; border-top:1px solid #8883; padding-top:14px; } h3 { font-size:14px; font-weight:500; } .reply { padding:14px 0; border-bottom:1px solid #8882; } .reply p { font-size:13px; line-height:1.9; white-space:pre-wrap; overflow-wrap:anywhere; margin-top:8px; } .reply-head time { margin-left:auto; font-size:10px; opacity:.6; } .author { min-height:36px; }
  .reply-form { display:flex; flex-direction:column; gap:8px; align-items:flex-end; margin-top:16px; } textarea { width:100%; padding:12px; border:1px solid #8884; background:#8881; color:inherit; border-radius:8px; resize:vertical; font-size:13px; line-height:1.8; } .reply-form button { background:#8882; } .hint { font-size:12px; opacity:.6; padding:18px 0; } .report-link { display:block; font-size:11px; opacity:.65; padding:18px 0 0; }
  @media(max-width:600px) { .reader { min-height:100%; padding:calc(16px + var(--app-safe-top)) calc(20px + var(--app-safe-right)) calc(24px + var(--app-safe-bottom)) calc(20px + var(--app-safe-left)); } .reader-actions .text-button { margin-left:0; } }
</style>
