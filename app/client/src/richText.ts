import type { JSONContent } from '@tiptap/core';

export interface RichText { version: 1; doc: JSONContent }
export const MAX_TEXT_LENGTH = 100000;
export const MAX_RICH_BYTES = 2_000_000;
const marks = new Set(['bold', 'italic', 'underline']);

// Keep this schema in sync with RichText.hs. Never render stored HTML.
export function validRichText(value: RichText | null | undefined): value is RichText {
  if (!value || value.version !== 1 || value.doc?.type !== 'doc' || !Array.isArray(value.doc.content)) return false;
  return value.doc.content.length > 0 && value.doc.content.every(block => {
    if (!block || !['paragraph', 'heading'].includes(block.type || '')) return false;
    if (block.type === 'heading' && ![1, 2].includes(block.attrs?.level)) return false;
    if (block.content === undefined) return true;
    return Array.isArray(block.content) && block.content.every(node => {
      if (!node || !['text', 'hardBreak'].includes(node.type || '')) return false;
      if (node.type === 'text' && (typeof node.text !== 'string' || !node.text.length)) return false;
      if (node.marks === undefined) return true;
      return Array.isArray(node.marks) && node.marks.length <= 3 && node.marks.every(mark => mark && marks.has(mark.type));
    });
  });
}

export function plainText(doc: JSONContent): string {
  return (doc.content || []).map(block => (block.content || []).map(node => node.type === 'hardBreak' ? '\n' : node.text || '').join('')).join('\n');
}

export function documentFor(text: string, richText?: RichText | null): JSONContent {
  if (validRichText(richText) && plainText(richText.doc) === text) return richText.doc;
  // Passing a JSON document also preserves literal HTML in old plain-text notes.
  return { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) };
}

export function hasFormatting(text: string, richText?: RichText | null): boolean {
  return (documentFor(text, richText).content || []).some(block => block.type === 'heading' || block.content?.some(node => node.marks?.length));
}
