<script lang="ts">
  import type { X } from '@lucide/svelte';
  let { label, icon: Icon, onclick, active = false, disabled = false, size = 20, fill = 'none', spin = false }: {
    label: string; icon: typeof X; onclick?: () => void; active?: boolean; disabled?: boolean; size?: number; fill?: string; spin?: boolean;
  } = $props();
</script>

<button type="button" class="icon-button" class:active title={label} aria-label={label} {onclick} {disabled}>
  <Icon {size} {fill} class={spin ? 'spin' : ''}/>
</button>

<style>
  .icon-button {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: var(--icon);
    transition: background .14s;
  }

  .icon-button:hover {
    background: #5f63681a;
  }

  .icon-button.active {
    background: #5f636818;
    color: var(--fg);
  }
</style>
