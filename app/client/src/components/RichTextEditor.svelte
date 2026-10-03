<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Editor, Extension } from '@tiptap/core';
  import { Plugin } from '@tiptap/pm/state';
  import StarterKit from '@tiptap/starter-kit';
  import { Placeholder } from '@tiptap/extensions';
  import { Bold, Italic, Underline, RemoveFormatting } from '@lucide/svelte';
  import { documentFor, MAX_TEXT_LENGTH, MAX_RICH_BYTES, plainText, type RichText } from '../richText';
  let { text, richText, formatting, editor = $bindable<Editor | null>(null), onChange, onHistory }: {
    text: string; richText?: RichText | null; formatting: boolean; editor?: Editor | null;
    onChange: (text: string, value: RichText) => void;
    onHistory: (undo: boolean, redo: boolean) => void;
  } = $props();
  let element: HTMLDivElement;
  let active = $state({ h1: false, h2: false, paragraph: true, bold: false, italic: false, underline: false });
  let limitMessage = $state('');

  onMount(() => {
    const instance = new Editor({
      element,
      content: documentFor(text, richText),
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2] }, blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, code: false, codeBlock: false, horizontalRule: false, link: false, strike: false, trailingNode: false }),
        Placeholder.configure({ placeholder: '메모 작성…' }),
        Extension.create({
          name: 'noteLimits',
          addProseMirrorPlugins: () => [new Plugin({
            filterTransaction: transaction => {
              if (!transaction.docChanged) return true;
              const doc = transaction.doc.toJSON();
              const withinLimit = plainText(doc).length <= MAX_TEXT_LENGTH && new TextEncoder().encode(JSON.stringify({ version: 1, doc })).length <= MAX_RICH_BYTES;
              limitMessage = withinLimit ? '' : '메모가 너무 길어요. 내용을 나누어 저장해 주세요.';
              return withinLimit;
            }
          })]
        })
      ],
      editorProps: { attributes: { class: 'rich-document', role: 'textbox', 'aria-label': '메모 내용', 'aria-multiline': 'true', spellcheck: 'true' } },
      onUpdate: ({ editor: current }) => {
        const doc = current.getJSON();
        onChange(plainText(doc), { version: 1, doc });
      },
      onTransaction: ({ editor: current }) => {
        active = { h1: current.isActive('heading', { level: 1 }), h2: current.isActive('heading', { level: 2 }), paragraph: current.isActive('paragraph'), bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline') };
        onHistory(current.can().undo(), current.can().redo());
      }
    });
    editor = instance;
    // Wait for Modal.showModal(), then focus synchronously. A delayed animation
    // frame can otherwise overwrite a selection the user has already made.
    void tick().then(() => {
      if (instance.isDestroyed) return;
      if (instance.view.hasFocus()) return;
      instance.commands.setTextSelection(instance.state.doc.content.size - 1);
      instance.view.focus();
    });
    return () => { instance.destroy(); editor = null; onHistory(false, false); };
  });
</script>

{#if formatting}
  <div class="format-toolbar" role="group" aria-label="본문 서식">
    <button type="button" title="제목 1" aria-label="제목 1" aria-pressed={active.h1} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().setHeading({ level: 1 }).run()}>H1</button>
    <button type="button" title="제목 2" aria-label="제목 2" aria-pressed={active.h2} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().setHeading({ level: 2 }).run()}>H2</button>
    <button type="button" title="일반 본문" aria-label="일반 본문" aria-pressed={active.paragraph} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().setParagraph().run()}>Aa</button>
    <span class="separator"></span>
    <button type="button" title="굵게 (Ctrl/⌘+B)" aria-label="굵게" aria-pressed={active.bold} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().toggleBold().run()}><Bold size={19}/></button>
    <button type="button" title="기울임 (Ctrl/⌘+I)" aria-label="기울임" aria-pressed={active.italic} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={19}/></button>
    <button type="button" title="밑줄 (Ctrl/⌘+U)" aria-label="밑줄" aria-pressed={active.underline} onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().toggleUnderline().run()}><Underline size={19}/></button>
    <button type="button" title="서식 지우기" aria-label="서식 지우기" onmousedown={e => e.preventDefault()} onclick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={19}/></button>
  </div>
{/if}

<div class="rich-editor" bind:this={element}></div>
{#if limitMessage}<p class="limit-message" role="status">{limitMessage}</p>{/if}

<style>
  .rich-editor { min-height: 76px; padding: 8px 24px 20px; font-size: 16px; line-height: 1.85; cursor: text; }
  .rich-editor :global(.tiptap) { min-height: 48px; outline: none; }
  .rich-editor :global(p.is-editor-empty:first-child::before) { content: attr(data-placeholder); color: var(--muted); float: left; height: 0; pointer-events: none; }
  .format-toolbar { display: flex; align-items: center; width: fit-content; max-width: calc(100% - 48px); margin: 0 24px 12px; padding: 4px; border: 1px solid #8884; border-radius: 8px; background: #8882; }
  .format-toolbar button { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 40px; border-radius: 50%; font-weight: 600; flex-shrink: 0; }
  .format-toolbar button:hover, .format-toolbar button[aria-pressed=true] { background: var(--hover); }
  .separator { height: 26px; width: 1px; background: var(--line); margin: 0 4px; }
  .limit-message { padding: 0 24px; color: var(--muted); font-size: 12px; }
  @media (max-width: 600px) {
    .rich-editor { padding: 10px 22px 20px; }
    .rich-editor :global(.tiptap) { min-height: 48px; }
    .format-toolbar { overflow-x: auto; flex-shrink: 0; }
    .format-toolbar button { width: 36px; }
  }
</style>
