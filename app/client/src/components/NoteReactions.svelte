<script lang="ts">
  import { Heart, MessageCircle } from '@lucide/svelte';
  import { errorMessage } from '../api';
  import type { Reactions } from '../notebookSocial.svelte';
  let { value, onLike, onConversation, conversationLabel = '댓글 보기' }: {
    value?: Reactions; onLike: () => Promise<void>; onConversation: () => void | Promise<void>; conversationLabel?: string;
  } = $props();
  let busy = $state(false), opening = $state(false), error = $state('');
  async function like() {
    if (busy) return; busy = true; error = '';
    try { await onLike(); } catch (e) { error = errorMessage(e); } finally { busy = false; }
  }
  async function conversation() {
    if (opening) return; opening = true; error = '';
    try { await onConversation(); } catch (e) { error = errorMessage(e); } finally { opening = false; }
  }
</script>
<div class="note-reactions" aria-label="메모 반응">
  <button type="button" aria-label={value?.liked ? '좋아요 취소' : '좋아요'} aria-pressed={value?.liked || false} class:liked={value?.liked} disabled={busy || !value} onclick={like}><Heart size={17} fill={value?.liked ? 'currentColor' : 'none'}/><span>{value?.likes ?? '—'}</span></button>
  <button type="button" aria-label={conversationLabel} disabled={opening} onclick={conversation}><MessageCircle size={17}/><span>{value?.replies ?? '—'}</span>{#if conversationLabel === '대화 보기'}<span>{opening ? '여는 중…' : conversationLabel}</span>{/if}</button>
</div>
{#if error}<p class="reaction-error" role="alert">{error}</p>{/if}
<style>
  .note-reactions { display:flex; align-items:center; gap:8px; position:relative; }
  button { display:flex; align-items:center; gap:6px; min-width:44px; min-height:44px; padding:8px; border-radius:20px; font-size:12px; }
  button:hover { background:#8882; } .liked { color:#c44261; }
  .reaction-error { position:relative; font-size:11px; line-height:1.6; padding:4px 8px; }
</style>
