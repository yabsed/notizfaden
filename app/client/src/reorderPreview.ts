import { displacementPath, directionalNeighbor, moveInOrder } from './reordering';
import { layoutCards } from './masonry';

const ANIMATION_ID = 'note-reorder';
const DURATION = 180;

// FLIP keeps interrupted moves continuous: measure the currently painted
// positions, change grid order, then animate from those positions to the layout.
function animateLayout(cards: HTMLElement[], change: () => void, lifted?: HTMLElement) {
  const before = cards.map(card => card.getBoundingClientRect());
  for (const card of cards) {
    for (const animation of card.getAnimations()) if (animation.id === ANIMATION_ID) animation.cancel();
  }
  change();
  const after = cards.map(card => card.getBoundingClientRect());
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  cards.forEach((card, index) => {
    if (card === lifted || !card.isConnected) return;
    const dx = before[index].left - after[index].left, dy = before[index].top - after[index].top;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
    card.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: 'translate(0, 0)' },
    ], { id: ANIMATION_ID, duration: DURATION, easing: 'cubic-bezier(.2,.8,.2,1)' });
  });
}

export function reorderPreview(node: HTMLElement, source: HTMLElement, ids: string[]) {
  const cards = [...node.querySelectorAll<HTMLElement>('[data-note-id]')];
  const originalOrder = new Map(cards.map(card => [card, card.style.order]));
  const origin = node.getBoundingClientRect();
  // Hit-test the original slots, not cards sliding underneath the pointer.
  // Otherwise a stationary pointer can repeatedly reverse the same move.
  const slots = cards.map(card => {
    const rect = card.getBoundingClientRect();
    return { card, id: card.dataset.noteId!, left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
  });
  let path: string[] | undefined;
  let destination: HTMLElement | null = null;
  return {
    path: () => path,
    neighbor: (key: string) => directionalNeighbor(slots, source.dataset.noteId!, key),
    targetAt(x: number, y: number) {
      const element = document.elementFromPoint(x, y);
      if (!element || !node.contains(element)) return null;
      const rect = node.getBoundingClientRect();
      const localX = x - rect.left, localY = y - rect.top;
      let target: HTMLElement | null = null, closest = Infinity;
      for (const slot of slots) {
        const dx = Math.max(slot.left - localX, 0, localX - slot.left - slot.width);
        const dy = Math.max(slot.top - localY, 0, localY - slot.top - slot.height);
        const distance = Math.hypot(dx, dy);
        if (distance < closest) { closest = distance; target = slot.card; }
      }
      return target === source ? null : target;
    },
    move(target: HTMLElement | null) {
      if (destination === target) return;
      destination = target;
      path = target ? displacementPath(slots, source.dataset.noteId!, target.dataset.noteId!) : undefined;
      const order = path ? moveInOrder(ids, source.dataset.noteId!, target!.dataset.noteId!, path) : ids;
      const positions = new Map(order.map((id, index) => [id, String(index)]));
      animateLayout(cards, () => {
        node.dataset.reorderPreview = '';
        for (const card of cards) card.style.order = path ? positions.get(card.dataset.noteId!)! : originalOrder.get(card)!;
        layoutCards(node, order);
        if (path) source.dataset.drop = 'preview'; else source.removeAttribute('data-drop');
      }, source);
    },
    restore() {
      // On success Svelte has already applied the committed DOM order. Removing
      // the temporary CSS order then leaves exactly the previewed arrangement.
      // Cancellation or a failed save animates back to the original DOM order.
      animateLayout(cards, () => {
        node.removeAttribute('data-reorder-preview');
        for (const card of cards) card.style.order = originalOrder.get(card)!;
        layoutCards(node);
        source.removeAttribute('data-drop');
      });
    },
  };
}
