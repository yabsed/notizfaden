<script lang="ts">
  import { Heart, MessageCircle } from '@lucide/svelte';
  import { noteStyle } from '../model';
  import { ago, displayName, type Post } from '../social';
  import RichTextView from './RichTextView.svelte';
  let { post, onOpen, onProfile, onLike }: { post: Post; onOpen: () => void; onProfile: () => void; onLike: (post: Post) => Promise<void> } = $props();
  let busy = $state(false);
  async function like() { if (busy) return; busy = true; try { await onLike(post); } finally { busy = false; } }
</script>
<article class="social-card" style={noteStyle(post.note.body.color)} data-testid="social-card">
  <button class="social-author" onclick={onProfile} aria-label={`${displayName(post.profile)} 프로필`}>
    <span class="avatar tiny">{post.profile.avatar || displayName(post.profile)[0]}</span><span class="author-name">{displayName(post.profile)}<small>@{post.profile.name}</small></span>
  </button>
  <button class="social-body" onclick={onOpen} aria-label={`${post.note.body.title || post.note.body.content.slice(0, 30) || '메모'} 열기`}>
    {#if post.note.body.title}<h3>{post.note.body.title}</h3>{/if}
    {#if post.note.body.kind === 'checklist'}<div class="preview">{#each post.note.body.items.slice(0, 8) as item}<p class:done={item.done}>{item.done ? '☑' : '☐'} {item.text}</p>{/each}</div>
    {:else}<div class="preview"><RichTextView text={post.note.body.content} richText={post.note.body.richText}/></div>{/if}
  </button>
  <div class="social-bottom">
    <button class:liked={post.liked} aria-label={post.liked ? '좋아요 취소' : '좋아요'} aria-pressed={post.liked} disabled={busy} onclick={like}><Heart size={17} fill={post.liked ? 'currentColor' : 'none'}/><span>{post.likes || ''}</span></button>
    <button aria-label="답글 보기" onclick={onOpen}><MessageCircle size={17}/><span>{post.replies || ''}</span></button>
    <time datetime={post.publishedAt} title={new Date(post.publishedAt).toLocaleString('ko-KR')}>{ago(post.publishedAt)}</time>
  </div>
</article>
<style>
  .social-card { break-inside: avoid; margin: 0 0 16px; border: 1px solid #8882; border-radius: 9px; background: var(--card-light); color: #202124; overflow: hidden; transition: box-shadow .18s; }
  :global([data-theme=dark]) .social-card { background: var(--card-dark); color: var(--fg); }
  .social-card:hover { box-shadow: var(--shadow); }
  .social-author { display: flex; align-items: center; gap: 9px; padding: 14px 15px 8px; text-align: left; width: 100%; min-height: 48px; }
  .author-name { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { display: block; font-size: 10px; opacity: .6; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
  .social-body { width: 100%; text-align: left; padding: 9px 16px 12px; }
  h3 { font-size: 15px; line-height: 1.6; margin-bottom: 9px; overflow-wrap: anywhere; }
  .preview { font-size: 13px; line-height: 1.85; max-height: 280px; overflow: hidden; overflow-wrap: anywhere; mask-image: linear-gradient(to bottom,black 92%,transparent); }
  .done { text-decoration: line-through; opacity: .6; }
  .social-bottom { display: flex; align-items: center; gap: 1px; padding: 0 7px 5px; }
  .social-bottom button { min-width: 44px; min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 4px; font-size: 11px; border-radius: 50%; }
  .social-bottom button:hover { background: #8882; }
  .liked { color: #c44261; }
  time { margin-left: auto; margin-right: 6px; font-size: 9px; opacity: .65; white-space: nowrap; }
  @media(max-width:600px) { .social-card { margin-bottom: 10px; } .social-author { padding: 10px 11px 4px; gap: 6px; } .social-body { padding: 8px 12px; } h3 { font-size: 13px; } .preview { font-size: 12px; max-height: 235px; } }
</style>
