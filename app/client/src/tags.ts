import type { NoteBody } from './model';

export const cleanTag = (value: string) => value.trim().replace(/^#+/, '').trim();
export const tagKey = (value: string) => cleanTag(value).toLowerCase();
export function uniqueTags(values: readonly string[]) {
  const tags = new Map<string, string>();
  for (const value of values) {
    const name = cleanTag(value), key = tagKey(name);
    if (name && !tags.has(key)) tags.set(key, name);
  }
  return [...tags.values()];
}
// Keep the existing storage/wire field so offline notes and old clients retain
// their data. Its values now represent tags and follow the note's visibility.
export const noteTags = (body: NoteBody) => uniqueTags(body.labels);
export const hasTag = (body: NoteBody, tag: string) => noteTags(body).some(value => tagKey(value) === tagKey(tag));
// A leading # searches one exact tag, including legacy names containing spaces.
export const queryTag = (query: string) => query.trim().startsWith('#') ? cleanTag(query) : null;
