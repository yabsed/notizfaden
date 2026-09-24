import type { Note, Session } from './model';

export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export class ApiError extends Error {
  constructor(public status: number, message: string, public current?: Note) { super(message); }
}
export async function request<T>(path: string, session?: Session | null, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${API}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new ApiError(response.status, error.message || '서버에 연결할 수 없습니다.', error.current); }
  return response.status === 204 ? undefined as T : response.json();
}

export function errorMessage(e: unknown) { return e instanceof ApiError || (e instanceof Error && !(e instanceof TypeError) && e.name !== 'TimeoutError') ? e.message : '연결을 확인해 주세요. 메모는 이 기기에 저장되어 있어요.'; }
