export type Visibility = 'private' | 'public';
export type Kind = 'text' | 'checklist';
export interface Item { id: string; text: string; done: boolean }
export interface NoteBody { title: string; content: string; kind: Kind; items: Item[]; color: string; labels: string[]; pinned: boolean; archived: boolean; trashed: boolean; sourceId: string | null }
export interface User { id: string; name: string }
export interface Note { id: string; body: NoteBody; visibility: Visibility; revision: number; updatedAt: string; author: User }
export interface LocalNote extends Note { scope: string; dirty: boolean; mutationId: string; conflict?: Note; syncError?: string }
export interface Session { token: string; user: User }
export const uid = () => crypto.randomUUID();
export const emptyBody = (kind: Kind = 'text'): NoteBody => ({ title: '', content: '', kind, items: [], color: 'default', labels: [], pinned: false, archived: false, trashed: false, sourceId: null });
export const newNote = (scope: string, kind: Kind = 'text'): LocalNote => ({ id: uid(), scope, body: emptyBody(kind), visibility: 'private', revision: 0, updatedAt: new Date().toISOString(), author: { id: scope, name: '나' }, dirty: true, mutationId: uid() });
export const hasContent = (b: NoteBody) => !!(b.title.trim() || b.content.trim() || b.items.some(i => i.text.trim()));
export function noteStyle(color: string) { const c = colors[color] || colors.default; return `--card-light:${c.light};--card-dark:${c.dark}`; }
// Color tokens and typography adapted from googlekeepclone/web/src/theme.js (MIT).
export const colors: Record<string, { name: string; light: string; dark: string }> = {
  default: { name: '기본', light: '#ffffff', dark: '#202124' },
  red: { name: '산호', light: '#f28b82', dark: '#5c2b29' },
  orange: { name: '살구', light: '#fbbc04', dark: '#614a19' },
  yellow: { name: '레몬', light: '#fff475', dark: '#635d18' },
  green: { name: '새싹', light: '#ccff90', dark: '#345920' },
  cyan: { name: '민트', light: '#a7ffeb', dark: '#16504b' },
  lightblue: { name: '하늘', light: '#cbf0f8', dark: '#2d555e' },
  purple: { name: '라벤더', light: '#d7aefb', dark: '#42275e' },
  pink: { name: '벚꽃', light: '#fdcfe8', dark: '#5b2245' },
  brown: { name: '모래', light: '#e6c9a8', dark: '#442f19' },
  grey: { name: '안개', light: '#e8eaed', dark: '#3c3f43' },
};
