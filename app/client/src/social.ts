import type { Note } from './model';
export interface Profile { id: string; name: string; displayName: string; bio: string; avatar: string; followers: number; followingCount: number; posts: number; following: boolean; blocked: boolean; blockedBy: boolean; muted: boolean }
export interface Post { note: Note; profile: Profile; likes: number; replies: number; liked: boolean; publishedAt: string }
export interface Page<T> { items: T[]; cursor: string | null }
export interface Reply { id: string; content: string; createdAt: string; profile: Profile }
export interface Notice { id: number; profile: Profile; kind: 'follow' | 'like' | 'reply'; noteId: string | null; createdAt: string; read: boolean }
export interface NotificationPage { items: Notice[]; cursor: number | null; unread: number }
export interface Report { id: number; reason: string; noteId: string | null; targetId: string; targetName: string; createdAt: string; resolved: boolean }
export const displayName = (p: Profile) => p.displayName || p.name;
export function ago(value: string) { const elapsed = Math.max(0, Date.now() - Date.parse(value)); return elapsed < 60000 ? '방금' : elapsed < 3600000 ? `${Math.floor(elapsed / 60000)}분 전` : elapsed < 86400000 ? `${Math.floor(elapsed / 3600000)}시간 전` : new Date(value).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }); }
export const avatarChoices = ['', '🌱', '🌼', '🌙', '🍊', '🐈', '🐻', '🪴', '☕', '🌊', '📚'];
