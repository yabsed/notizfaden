import { tick } from 'svelte';
import { reorderPreview } from './reorderPreview';

interface Options {
  enabled: boolean;
  context: string;
  ids: string[];
  onMove: (id: string, target: string, path?: string[]) => Promise<boolean>;
}

const MOVE_THRESHOLD = 8;

// Mouse gestures depend only on distance. Touch waits briefly so ordinary
// vertical swipes can still scroll the page without rearranging cards.
export function reorderable(node: HTMLElement, initial: Options) {
  let options = initial;
  let source: HTMLElement | null = null, target: HTMLElement | null = null;
  let active = false, pointer: number | null = null, touch: number | null = null;
  let startX = 0, startY = 0, x = 0, y = 0, offsetX = 0, offsetY = 0, frame = 0;
  let suppressClickUntil = 0, touchReady = false, holdTimer: ReturnType<typeof setTimeout> | undefined;
  let ghost: HTMLElement | null = null, saving = false;
  let preview: ReturnType<typeof reorderPreview> | null = null;
  let landing: ReturnType<typeof reorderPreview> | null = null;
  const abort = new AbortController();
  const cardAt = (element: EventTarget | null) => {
    const card = element instanceof Element ? element.closest<HTMLElement>('[data-note-id]') : null;
    return card && node.contains(card) && options.ids.includes(card.dataset.noteId!) ? card : null;
  };
  function markTarget() {
    target = preview?.targetAt(x, y) || null;
    preview?.move(target);
  }
  function scroll() {
    if (!active) return;
    const rect = node.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right) {
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 64;
      const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
      const bottom = nav && nav.height ? nav.top : window.innerHeight;
      const speed = y < top + 55 ? -Math.min(16, (top + 55 - y) / 3) : y > bottom - 55 ? Math.min(16, (y - bottom + 55) / 3) : 0;
      if (speed) { window.scrollBy(0, speed); markTarget(); }
    }
    frame = requestAnimationFrame(scroll);
  }
  function activate() {
    if (!source || active) return;
    active = true; source.dataset.dragging = '';
    preview = reorderPreview(node, source, [...options.ids]);
    if (pointer !== null) node.setPointerCapture(pointer);
    ghost = source.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-dragging'); ghost.removeAttribute('data-note-id'); ghost.removeAttribute('data-testid');
    ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
    ghost.dataset.dragGhost = '';
    ghost.style.cssText += `;position:fixed;width:${source.offsetWidth}px;pointer-events:none;opacity:.95;z-index:1000;box-shadow:0 12px 32px #0004;transform:scale(1.02);margin:0;`;
    document.body.append(ghost); positionGhost();
    frame = requestAnimationFrame(scroll);
  }
  function positionGhost() {
    if (ghost) { ghost.style.left = `${x - offsetX}px`; ghost.style.top = `${y - offsetY}px`; }
  }
  function clearLanding() { landing?.restore(); landing = null; }
  function reset() {
    clearLanding();
    if (active || touchReady) suppressClickUntil = performance.now() + 400;
    clearTimeout(holdTimer); touchReady = false; touch = null;
    cancelAnimationFrame(frame); target = null;
    preview?.restore(); preview = null; source?.removeAttribute('data-dragging'); source?.removeAttribute('data-reorder-ready');
    ghost?.remove(); ghost = null; active = false; source = null;
    const released = pointer; pointer = null;
    if (released !== null && node.hasPointerCapture(released)) node.releasePointerCapture(released);
  }
  async function commit(id: string, destination: string, focus = false, path?: string[]) {
    if (saving || !options.enabled) return false;
    const context = options.context;
    saving = true;
    try {
      const moved = await options.onMove(id, destination, path);
      await tick();
      if (focus) requestAnimationFrame(() => {
        if (context !== options.context || !node.isConnected) return;
        [...node.querySelectorAll<HTMLElement>('[data-note-id]')].find(card => card.dataset.noteId === id)?.querySelector<HTMLButtonElement>('.card-open')?.focus();
      });
      return moved;
    } finally { saving = false; }
  }
  function finish() {
    const id = source?.dataset.noteId, destination = target?.dataset.noteId;
    const path = preview?.path();
    const move = active && id && destination && path;
    if (!move) { reset(); return; }
    // Keep the preview in place while the asynchronous local save renders.
    const pending = preview; preview = null;
    reset(); landing = pending;
    void commit(id, destination, false, path).then(moved => { if (!moved) clearLanding(); }, clearLanding);
  }
  function begin(element: EventTarget | null, clientX: number, clientY: number) {
    if (!options.enabled || saving || landing || source || options.ids.length < 2 || !(element instanceof Element)) return false;
    const control = element.closest('button,input,a,select,textarea,label,[contenteditable=true]');
    if (control && !control.classList.contains('card-open')) return false;
    source = cardAt(element); if (!source) return false;
    suppressClickUntil = 0;
    startX = x = clientX; startY = y = clientY;
    const rect = source.getBoundingClientRect(); offsetX = x - rect.left; offsetY = y - rect.top;
    return true;
  }
  // Prevent the browser's native drag from taking over the distance gesture.
  node.addEventListener('dragstart', event => { if (source) event.preventDefault(); }, { signal: abort.signal });
  node.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
    if (begin(event.target, event.clientX, event.clientY)) pointer = event.pointerId;
  }, { signal: abort.signal });
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if (!(event.buttons & 1)) { reset(); return; }
    x = event.clientX; y = event.clientY;
    if (Math.hypot(x - startX, y - startY) >= MOVE_THRESHOLD) activate();
    if (active) { event.preventDefault(); markTarget(); positionGhost(); }
  }, { signal: abort.signal });
  document.addEventListener('pointerup', event => { if (event.pointerId === pointer) finish(); }, { signal: abort.signal });
  document.addEventListener('pointercancel', event => { if (event.pointerId === pointer) reset(); }, { signal: abort.signal });
  node.addEventListener('lostpointercapture', event => { if (event.pointerId === pointer) reset(); }, { signal: abort.signal });
  node.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { reset(); return; }
    const point = event.touches[0];
    if (!begin(event.target, point.clientX, point.clientY)) return;
    touch = point.identifier;
    holdTimer = setTimeout(() => { if (source) { touchReady = true; source.dataset.reorderReady = ''; } }, 350);
  }, { passive: true, signal: abort.signal });
  node.addEventListener('touchmove', event => {
    const point = [...event.touches].find(item => item.identifier === touch);
    if (!point) return;
    x = point.clientX; y = point.clientY;
    const moved = Math.hypot(x - startX, y - startY) >= MOVE_THRESHOLD;
    if (!touchReady) { if (moved) reset(); return; }
    event.preventDefault();
    if (moved) activate();
    if (active) { markTarget(); positionGhost(); }
  }, { passive: false, signal: abort.signal });
  node.addEventListener('touchend', event => { if ([...event.changedTouches].some(point => point.identifier === touch)) finish(); }, { signal: abort.signal });
  node.addEventListener('touchcancel', reset, { signal: abort.signal });
  node.addEventListener('contextmenu', event => { if (touch !== null) event.preventDefault(); }, { signal: abort.signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && source) { event.preventDefault(); reset(); }
  }, { signal: abort.signal });
  node.addEventListener('keydown', event => {
    if (!options.enabled || saving || source || landing || !event.altKey || !(event.target instanceof Element) || !event.target.closest('.card-open')) return;
    const card = cardAt(event.target), id = card?.dataset.noteId;
    if (!id || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') {
      const destination = event.key === 'Home' ? options.ids[0] : options.ids.at(-1)!;
      if (destination !== id) void commit(id, destination, true);
      return;
    }
    const pending = reorderPreview(node, card!, [...options.ids]);
    const destination = pending.neighbor(event.key);
    const target = [...node.querySelectorAll<HTMLElement>('[data-note-id]')].find(card => card.dataset.noteId === destination);
    if (!target) return;
    pending.move(target); landing = pending;
    void commit(id, destination!, true, pending.path()).then(moved => { if (!moved) clearLanding(); }, clearLanding);
  }, { signal: abort.signal });
  node.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, signal: abort.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, { signal: abort.signal });
  window.addEventListener('blur', reset, { signal: abort.signal });
  window.addEventListener('resize', reset, { signal: abort.signal });
  return {
    update(next: Options) {
      if (options.context !== next.context || !next.enabled) reset();
      else if (options.ids.join() !== next.ids.join()) {
        if (source) reset();
        // The reactive order update can arrive after IndexedDB's save promise.
        // Release CSS ordering only after Svelte moves the actual card nodes.
        const pending = landing;
        void tick().then(() => { if (landing === pending) clearLanding(); });
      }
      options = next;
    },
    destroy() { reset(); abort.abort(); },
  };
}
