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

<style>
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    padding: 10px 0;
    position: relative;
  }

  .palette button {
    border-radius: 50%;
    width: 25px;
    height: 25px;
    border: 1px solid #20212420;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #303134;
  }

  .palette button.selected {
    outline: 2px solid #8b6db1;
    outline-offset: 1px;
  }

  .palette button:hover {
    outline: 2px solid #777;
    outline-offset: 1px;
  }
</style>
