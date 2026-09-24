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
