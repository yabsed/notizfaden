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
