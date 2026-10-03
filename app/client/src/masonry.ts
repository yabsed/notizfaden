// Visit each column once per logical row, stacking columns independently.
// Height changes displace cards only below the change in the affected column.
export function layoutCards(node: HTMLElement, order?: readonly string[]) {
  const cards = [...node.children].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const ranks = order && new Map(order.map((id, index) => [id, index]));
  if (ranks) cards.sort((a, b) => (ranks.get(a.dataset.noteId!) ?? Infinity) - (ranks.get(b.dataset.noteId!) ?? Infinity));
  const columns = Math.max(1, getComputedStyle(node).gridTemplateColumns.split(' ').length);
  const bottoms = Array<number>(columns).fill(1);
  const spans = cards.map(card => Math.ceil(card.getBoundingClientRect().height + (parseFloat(getComputedStyle(card).marginBottom) || 0)));
  cards.forEach((card, index) => {
    const column = index % columns, span = Math.max(1, spans[index]);
    card.style.gridColumnStart = String(column + 1);
    card.style.gridRowStart = String(bottoms[column]);
    card.style.gridRowEnd = `span ${span}`;
    bottoms[column] += span;
  });
}

export function masonry(node: HTMLElement) {
  let frame = 0;
  const observed = new Set<HTMLElement>();
  function layout() {
    frame = 0;
    if (!node.hasAttribute('data-reorder-preview')) layoutCards(node);
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
  const resize = new ResizeObserver(schedule);
  resize.observe(node);
  function observeCards() {
    const cards = new Set([...node.children].filter((el): el is HTMLElement => el instanceof HTMLElement));
    for (const card of observed) if (!cards.has(card)) { resize.unobserve(card); observed.delete(card); }
    for (const card of cards) if (!observed.has(card)) { observed.add(card); resize.observe(card); }
    schedule();
  }
  const mutations = new MutationObserver(observeCards);
  mutations.observe(node, { childList: true });
  observeCards();
  return { destroy() { cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); } };
}
