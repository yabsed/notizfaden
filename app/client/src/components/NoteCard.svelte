<script lang="ts">
  import { Archive, ArchiveRestore, Copy, Globe2, LockKeyhole, Palette, Pin, RotateCcw, Trash2 } from '@lucide/svelte';
  import { noteStyle, type LocalNote, type Note, type NoteBody } from '../model';
  import IconButton from './IconButton.svelte';
  import PalettePicker from './PalettePicker.svelte';
  import NoteReactions from './NoteReactions.svelte';
  import { displayName, type Profile } from '../social';
  import type { Reactions } from '../notebookSocial.svelte';
  import RichTextView from './RichTextView.svelte';
  let { note, own = true, canReorder = false, onOpen, onChange, onFork, onTag, reactions, onLike, onConversation, author, onProfile, testId = 'note-card' }: {
    canReorder?: boolean;
    author?: Profile | null; onProfile?: () => void; testId?: string;
    reactions?: Reactions; onLike?: () => Promise<void>; onConversation?: () => void;
    note: Note; own?: boolean; onOpen: () => void; onChange?: (patch: Partial<NoteBody>) => void; onFork?: () => void; onTag?: (label: string) => void;
  } = $props();
  let b = $derived(note.body);
  let palette = $state(false);
</script>

<article class="note-card" class:plain={b.color === 'default'} class:reorderable={canReorder} draggable={false} style={noteStyle(b.color)} data-note-id={note.id} data-testid={testId}>
  <button class="card-open" title={canReorder ? '클릭해 자세히 보기 · 드래그해 이동 · Alt+방향키로 순서 변경' : undefined} aria-keyshortcuts={canReorder ? 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+Home Alt+End' : undefined} onclick={onOpen} aria-label={`${b.title || b.content.slice(0, 30) || '빈 메모'} 열기`}></button>
  <button class="card-author" onclick={onProfile} disabled={!onProfile} aria-label={`${author ? displayName(author) : note.author.name || '나'} 프로필`}><span class="avatar tiny">{author?.avatar || (author ? displayName(author)[0] : note.author.name?.[0] || '나')}</span><span>{author ? displayName(author) : note.author.name || '나'}</span></button>
  {#if own && !b.trashed}
    <div class="pin-action" class:pinned={b.pinned}><IconButton label={b.pinned ? '고정 해제' : '메모 고정'} icon={Pin} size={18} active={b.pinned} fill={b.pinned ? 'currentColor' : 'none'} onclick={() => onChange?.({ pinned: !b.pinned })}/></div>
  {/if}
  {#if b.title}<h3>{b.title}</h3>{/if}
  {#if b.kind === 'checklist'}
    <div class="card-checklist">
      {#each b.items.slice(0, 9) as item (item.id)}
        <label class:completed={item.done}><input type="checkbox" checked={item.done} disabled={!own || b.trashed} onchange={() => onChange?.({ items: b.items.map(i => i.id === item.id ? { ...i, done: !i.done } : i) })}/><span>{item.text || '빈 항목'}</span></label>
      {/each}
      {#if b.items.length > 9}<small>+ {b.items.length - 9}개 항목</small>{/if}
    </div>
  {:else}<div class="card-text"><RichTextView text={b.content || (!b.title ? '빈 메모' : '')} richText={b.richText}/></div>{/if}
  {#if b.labels.length}<div class="labels">{#each b.labels as label}<button onclick={() => onTag?.(label)}>{label}</button>{/each}</div>{/if}
  {#if (note as LocalNote).conflict}<span class="conflict-badge">다른 기기의 수정본이 있어요</span>{/if}
  <div class="card-bottom">
    <span class="visibility" title={note.visibility === 'public' ? '전체 공개' : '나만 보기'}>{#if note.visibility === 'public'}<Globe2 size={13}/> 공개{:else}<LockKeyhole size={12}/> 비공개{/if}</span>
    <div class="card-actions">
      {#if !own}{#if onFork}<IconButton label="내 메모로 이어 쓰기" icon={Copy} size={16} onclick={onFork}/>{/if}
      {:else if b.trashed}<IconButton label="메모 복원" icon={RotateCcw} size={16} onclick={() => onChange?.({ trashed: false })}/>
      {:else}
        <IconButton label="색상 바꾸기" icon={Palette} size={16} onclick={() => palette = !palette}/>
        <IconButton label={b.archived ? '보관 해제' : '메모 보관'} icon={b.archived ? ArchiveRestore : Archive} size={16} onclick={() => onChange?.({ archived: !b.archived })}/>
        <IconButton label="휴지통으로 이동" icon={Trash2} size={16} onclick={() => onChange?.({ trashed: true })}/>
      {/if}
    </div>
  </div>
  {#if note.visibility === 'public' && !b.trashed && onLike && onConversation}<NoteReactions value={reactions} {onLike} {onConversation}/>{/if}
  {#if palette}<div class="card-palette"><PalettePicker selected={b.color} onChange={color => { onChange?.({ color }); palette = false; }}/></div>{/if}
</article>

<style>
  .reorderable .card-open { cursor:grab; user-select:none; -webkit-touch-callout:none; }
  .note-card:global([data-reorder-ready]) { box-shadow:0 4px 16px #0003; }
  .note-card:global([data-dragging]) .card-open { cursor:grabbing; }
  .note-card:global([data-dragging]) { opacity:.35; }
  .note-card:global([data-drop]) { outline:2px solid var(--fg); outline-offset:3px; }
  .card-author { display:flex; align-items:center; gap:7px; min-height:36px; max-width:calc(100% - 24px); position:relative; font-size:12px; margin:-7px 0 8px; text-align:left; }
  .card-author > span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card-author:disabled { opacity:1; }

  .note-card {
    position: relative;
    min-width: 0;
    margin-bottom: 16px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--card-light);
    padding: 18px 16px 6px;
    transition: box-shadow .15s;
    color: #202124;
    overflow-wrap: anywhere;
  }

  .note-card.plain {
    border-color: var(--line);
    color: var(--fg);
  }

  :global([data-theme=dark]) .note-card {
    background: var(--card-dark);
    color: var(--fg);
  }

  .note-card:hover,
  .note-card:focus-within {
    box-shadow: 0 2px 5px #20212430;
  }

  .note-card h3 {
    font-size: 15px;
    font-weight: 500;
    line-height: 1.6;
    letter-spacing: -.25px;
    margin-bottom: 11px;
    padding-right: 16px;
    pointer-events: none;
    position: relative;
  }

  .card-open {
    position: absolute;
    inset: 0;
    width: 100%;
    border-radius: 8px;
    z-index: 0;
  }

  .card-open:focus-visible {
    outline-offset: 2px;
  }

  .card-text {
    font-size: 13px;
    line-height: 1.9;
    white-space: pre-wrap;
    max-height: 360px;
    overflow: hidden;
    position: relative;
    pointer-events: none;
    letter-spacing: -.1px;
  }

  .pin-action {
    position: absolute;
    right: 5px;
    top: 6px;
    opacity: 0;
    z-index: 2;
  }

  .pin-action :global(.icon-button) {
    width: 30px;
    height: 30px;
    color: inherit;
  }

  .pin-action.pinned,
  .note-card:hover .pin-action,
  .note-card:focus-within .pin-action {
    opacity: 1;
  }

  .card-checklist {
    font-size: 13px;
    line-height: 1.6;
    position: relative;
    pointer-events: none;
  }

  .card-checklist label {
    display: flex;
    gap: 10px;
    margin-bottom: 8px;
    align-items: flex-start;
    pointer-events: auto;
    position: relative;
    width: fit-content;
    max-width: 100%;
    cursor: pointer;
  }

  .card-checklist input {
    margin: 2px 0 0;
    opacity: .85;
  }

  .completed span {
    text-decoration: line-through;
    opacity: .55;
  }

  .card-checklist small {
    color: var(--muted);
  }

  .card-bottom {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 30px;
    position: relative;
    pointer-events: none;
  }

  .visibility {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: .56;
    font-size: 10px;
  }

  .card-actions {
    display: flex;
    opacity: 0;
    transition: opacity .15s;
    pointer-events: auto;
  }

  .note-card:hover .card-actions,
  .note-card:focus-within .card-actions {
    opacity: 1;
  }

  .card-actions :global(.icon-button) {
    width: 30px;
    height: 30px;
    color: inherit;
    opacity: .7;
  }


  .card-palette {
    position: relative;
    margin: 3px -8px 5px;
    padding: 6px;
    border-top: 1px solid #0001;
  }

  .conflict-badge {
    font-size: 11px;
    display: block;
    position: relative;
    color: #9b4422;
    margin-top: 10px;
  }

  @media (max-width: 600px) {
    .note-card {
      padding: 14px 12px 5px;
      margin-bottom: 10px;
    }

    .note-card h3 {
      font-size: 13px;
      line-height: 1.65;
      margin-bottom: 9px;
      letter-spacing: -.4px;
    }

    .card-text {
      font-size: 12px;
      line-height: 1.8;
    }

    .card-checklist {
      font-size: 12px;
    }

    .card-checklist label {
      gap: 7px;
    }

    .card-checklist input {
      width: 15px;
      height: 15px;
    }

    .card-actions {
      opacity: 1;
    }

    .card-actions :global(.icon-button) {
      width: 26px;
      height: 30px;
    }

    .card-actions :global(.icon-button) :global(svg) {
      width: 15px;
    }

    .pin-action {
      opacity: 1;
      top: 5px;
      right: 2px;
    }

    .pin-action:not(.pinned) {
      opacity: .3;
    }

    .pin-action :global(.icon-button) {
      width: 27px;
      height: 27px;
    }

    .pin-action :global(svg) {
      width: 15px;
    }

    .visibility {
      font-size: 8px;
      gap: 3px;
    }

    .card-bottom {
      margin-top: 9px;
      gap: 2px;
    }
  }

  @media (hover: none) {
    .card-actions {
      opacity: 1;
    }

    .pin-action {
      opacity: .5;
    }

    .pin-action.pinned {
      opacity: 1;
    }
  }
</style>
