<script lang="ts">
  import { Check } from '@lucide/svelte';
  import { colors } from '../model';
  let { selected, onChange }: { selected: string; onChange: (color: string) => void } = $props();
</script>

<div class="palette" role="group" aria-label="메모 색상">
  {#each Object.entries(colors) as [key, value]}
    <button type="button" title={value.name} aria-label={value.name} aria-pressed={selected === key} onclick={() => onChange(key)} style:background={value.light} class:selected={selected === key}>
      {#if selected === key}<Check size={16}/>{/if}
    </button>
  {/each}
</div>
