<script lang="ts">
  import { Copy, Globe2, X } from '@lucide/svelte';
  import { noteStyle, type Note } from '../model';
  import IconButton from './IconButton.svelte';
  import Modal from './Modal.svelte';
  let { note, onClose, onFork }: { note: Note; onClose: () => void; onFork: () => void } = $props();
</script>

<Modal label="공개 메모" {onClose} class="editor-dialog">
  <div class="reader" style={noteStyle(note.body.color)}>
    <div class="reader-head"><span class="author"><span class="avatar tiny">{note.author.name[0].toUpperCase()}</span>{note.author.name}</span><IconButton label="닫기" icon={X} onclick={onClose}/></div>
    <h2>{note.body.title}</h2>
    {#if note.body.kind === 'checklist'}
      {#each note.body.items as item (item.id)}<p class:completed={item.done}>{item.done ? '☑' : '☐'} {item.text}</p>{/each}
    {:else}<p class="reader-content">{note.body.content}</p>{/if}
    <div class="reader-footer"><span><Globe2 size={14}/> 전체 공개</span><button class="text-button" onclick={onFork}><Copy size={16}/> 내 메모로 이어 쓰기</button></div>
  </div>
</Modal>

<style>
  :global([data-theme=dark]) .reader {
    background: var(--card-dark);
    color: var(--fg);
  }

  .reader p.completed {
    text-decoration: line-through;
    opacity: .55;
  }

  .reader {
    padding: 18px 24px 12px;
    background: var(--card-light);
  }

  .reader-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .reader h2 {
    font-size: 20px;
    margin: 10px 0 20px;
    font-weight: 500;
  }

  .reader-content {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.9;
    font-size: 15px;
    min-height: 120px;
  }

  .reader-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 30px;
    padding-top: 10px;
    border-top: 1px solid #8883;
  }

  .reader-footer > span {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--icon);
  }

  @media (max-width: 600px) {
    .reader {
      min-height: 100%;
      display: flex;
      flex-direction: column;
      padding-top: 20px;
    }

    .reader-footer {
      margin-top: auto;
      padding-top: 20px;
    }

    .reader-content {
      flex: 1;
      padding-bottom: 30px;
    }
  }
</style>
