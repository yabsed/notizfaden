<script lang="ts">
  import { Archive, ArchiveRestore, Copy, Globe2, LockKeyhole, Palette, Pin, RotateCcw, Trash2 } from '@lucide/svelte';
  import { noteStyle, type LocalNote, type Note, type NoteBody } from '../model';
  import IconButton from './IconButton.svelte';
  import PalettePicker from './PalettePicker.svelte';
  let { note, own = true, onOpen, onChange, onFork, onTag }: {
    note: Note; own?: boolean; onOpen: () => void; onChange?: (patch: Partial<NoteBody>) => void; onFork?: () => void; onTag?: (label: string) => void;
  } = $props();
  let b = $derived(note.body);
  let palette = $state(false);
</script>

<article class="note-card" class:plain={b.color === 'default'} style={noteStyle(b.color)} data-testid="note-card">
  <button class="card-open" onclick={onOpen} aria-label={`${b.title || b.content.slice(0, 30) || '빈 메모'} 열기`}></button>
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
  {:else}<p class="card-text">{b.content || (!b.title ? '빈 메모' : '')}</p>{/if}
  {#if b.labels.length}<div class="labels">{#each b.labels as label}<button onclick={() => onTag?.(label)}>{label}</button>{/each}</div>{/if}
  {#if (note as LocalNote).conflict}<span class="conflict-badge">다른 기기의 수정본이 있어요</span>{/if}
  <div class="card-bottom">
    {#if own}
      <span class="visibility" title={note.visibility === 'public' ? '전체 공개' : '나만 보기'}>{#if note.visibility === 'public'}<Globe2 size={13}/> 전체 공개{:else}<LockKeyhole size={12}/>{/if}</span>
    {:else}<span class="author"><span class="avatar tiny">{note.author.name[0].toUpperCase()}</span>{note.author.name}</span>{/if}
    <div class="card-actions">
      {#if !own}<IconButton label="내 메모로 이어 쓰기" icon={Copy} size={16} onclick={onFork}/>
      {:else if b.trashed}<IconButton label="메모 복원" icon={RotateCcw} size={16} onclick={() => onChange?.({ trashed: false })}/>
      {:else}
        <IconButton label="색상 바꾸기" icon={Palette} size={16} onclick={() => palette = !palette}/>
        <IconButton label={b.archived ? '보관 해제' : '메모 보관'} icon={b.archived ? ArchiveRestore : Archive} size={16} onclick={() => onChange?.({ archived: !b.archived })}/>
        <IconButton label="휴지통으로 이동" icon={Trash2} size={16} onclick={() => onChange?.({ trashed: true })}/>
      {/if}
    </div>
  </div>
  {#if palette}<div class="card-palette"><PalettePicker selected={b.color} onChange={color => { onChange?.({ color }); palette = false; }}/></div>{/if}
</article>
