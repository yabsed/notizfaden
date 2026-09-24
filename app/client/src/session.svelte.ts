import { onMount } from 'svelte';
import { request } from './api';
import { importGuest } from './db';
import type { Session } from './model';

const storageKey = 'teum-session';

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); }
  catch { return null; }
}

export function createSession(onExternalChange: () => void) {
  let current = $state.raw<Session | null>(readSession());

  onMount(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      current = readSession();
      onExternalChange();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  });

  async function connect(next: Session, bring: boolean) {
    if (bring) await importGuest(next.user.id);
    localStorage.setItem(storageKey, JSON.stringify(next));
    current = next;
  }

  async function logout() {
    if (!current) return;
    try { await request('/auth/logout', current, 'POST'); }
    catch { /* Local sign-out remains available offline. */ }
    localStorage.removeItem(storageKey);
    current = null;
  }

  return {
    get current() { return current; },
    connect,
    logout,
  };
}
