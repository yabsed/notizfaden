<script lang="ts">
  import type { JSONContent } from '@tiptap/core';
  import { documentFor, type RichText } from '../richText';
  let { text, richText }: { text: string; richText?: RichText | null } = $props();
  let doc = $derived(documentFor(text, richText));
</script>

{#snippet inline(nodes: JSONContent[] = [])}
  {#each nodes as node}
    {#if node.type === 'hardBreak'}<br/>{:else}<span class:rich-bold={node.marks?.some(m => m.type === 'bold')} class:rich-italic={node.marks?.some(m => m.type === 'italic')} class:rich-underline={node.marks?.some(m => m.type === 'underline')}>{node.text}</span>{/if}
  {/each}
{/snippet}

<div class="rich-document">
  {#each doc.content || [] as block}
    {#if block.type === 'heading' && block.attrs?.level === 1}<h1>{@render inline(block.content)}</h1>
    {:else if block.type === 'heading'}<h2>{@render inline(block.content)}</h2>
    {:else}<p>{@render inline(block.content)}{#if !block.content?.length}<br/>{/if}</p>{/if}
  {/each}
</div>
