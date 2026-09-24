<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  let { label, children, onClose, class: className = '' }: { label: string; children: Snippet; onClose: () => void; class?: string } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => { dialog.showModal(); return () => dialog.close(); });
</script>

<!-- The click handler closes only the native dialog's backdrop; Escape uses oncancel. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<dialog bind:this={dialog} aria-label={label} class={className} oncancel={e => { e.preventDefault(); onClose(); }} onclick={e => { if (e.target === dialog) onClose(); }}>
  {@render children()}
</dialog>

<style>
  dialog {
    border: 1px solid var(--line);
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    border-radius: 12px;
    box-shadow: 0 10px 50px #0003;
    max-width: calc(100vw - 32px);
    max-height: 90dvh;
    overflow: auto;
  }

  dialog::backdrop {
    background: #20212466;
    backdrop-filter: blur(1px);
  }

  .editor-dialog {
    width: 600px;
  }

  .account-dialog {
    width: 430px;
    padding: 28px;
  }

  @media (max-width: 600px) {
    .editor-dialog {
      width: 100vw;
      max-width: 100vw;
      height: 100dvh;
      max-height: 100dvh;
      margin: 0;
      border: 0;
      border-radius: 0;
    }

    .account-dialog {
      padding: 23px;
      max-width: calc(100vw - 24px);
    }
  }
</style>
