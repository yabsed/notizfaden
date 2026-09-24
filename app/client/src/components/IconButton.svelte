<script lang="ts">
  import type { X } from '@lucide/svelte';
  let { label, icon: Icon, onclick, active = false, disabled = false, size = 20, fill = 'none', spin = false }: {
    label: string; icon: typeof X; onclick?: () => void; active?: boolean; disabled?: boolean; size?: number; fill?: string; spin?: boolean;
  } = $props();
</script>

<button type="button" class="icon-button" class:active title={label} aria-label={label} {onclick} {disabled}>
  <Icon {size} {fill} class={spin ? 'spin' : ''}/>
</button>
