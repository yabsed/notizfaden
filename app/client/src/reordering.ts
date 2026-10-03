// Design reference: AOSP Launcher3 ReorderAlgorithm.rearrangementExists and
// CellLayout.performReorder (submodules/launcher3, 2663cf0a). Independently
// implemented for variable-height web cards: adjacent displacement, a stable
// snapshot, and exactly the same plan for preview and commit.
export interface Slot { id: string; left: number; top: number; width: number; height: number }

export function moveInOrder(ids: readonly string[], id: string, target: string, path?: readonly string[]) {
  const result = [...ids], from = ids.indexOf(id), to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return result;
  if (!path) { // Explicit keyboard Home/End: insert at the beginning/end.
    result.splice(from, 1); result.splice(to, 0, id);
    return result;
  }
  if (path.length < 2 || path[0] !== id || path.at(-1) !== target ||
      new Set(path).size !== path.length || path.some(value => !ids.includes(value))) return result;
  // Pass the lifted card's vacancy through adjacent slots to the destination.
  // IDs outside this path never change slots.
  path.forEach((value, index) => { result[ids.indexOf(value)] = path[index + 1] ?? id; });
  return result;
}

const centerY = (slot: Slot) => slot.top + slot.height / 2;

export function adjacentSlots(slots: readonly Slot[]) {
  const columns: Slot[][] = [];
  for (const slot of [...slots].sort((a, b) => a.left - b.left || a.top - b.top)) {
    const column = columns.find(items => Math.abs(items[0].left - slot.left) < 1);
    if (column) column.push(slot); else columns.push([slot]);
  }
  const edges = new Map(slots.map(slot => [slot.id, new Set<string>()]));
  const connect = (a: Slot, b: Slot) => { edges.get(a.id)!.add(b.id); edges.get(b.id)!.add(a.id); };
  columns.forEach((column, index) => {
    column.forEach((slot, row) => { if (row) connect(column[row - 1], slot); });
    const next = columns[index + 1];
    if (!next) return;
    // A tall card can border several shorter cards. Never jump past a column.
    for (const a of column) for (const b of next) {
      if (Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top)) connect(a, b);
    }
  });
  return edges;
}

// Fewest displaced neighbors first, then shortest total pixel travel. Original
// slot order breaks ties deterministically. Freeze this graph for the gesture
// so moving previews cannot change hit-testing or oscillate under the pointer.
export function displacementPath(slots: readonly Slot[], id: string, target: string): string[] | undefined {
  const edges = adjacentSlots(slots), byId = new Map(slots.map(slot => [slot.id, slot]));
  if (!byId.has(id) || !byId.has(target) || id === target) return undefined;
  const costs = new Map<string, { steps: number; distance: number; path: string[] }>();
  costs.set(id, { steps: 0, distance: 0, path: [id] });
  const pending = new Set(slots.map(slot => slot.id));
  while (pending.size) {
    let current: string | undefined;
    for (const candidate of pending) {
      const cost = costs.get(candidate), best = current ? costs.get(current)! : undefined;
      if (cost && (!best || cost.steps < best.steps || cost.steps === best.steps && cost.distance < best.distance)) current = candidate;
    }
    if (!current) return undefined;
    const cost = costs.get(current)!;
    if (current === target) return cost.path;
    pending.delete(current);
    const a = byId.get(current)!;
    for (const neighbor of edges.get(current)!) {
      if (!pending.has(neighbor)) continue;
      const b = byId.get(neighbor)!;
      const next = { steps: cost.steps + 1, distance: cost.distance + Math.hypot(a.left - b.left, a.top - b.top), path: [...cost.path, neighbor] };
      const previous = costs.get(neighbor);
      if (!previous || next.steps < previous.steps || next.steps === previous.steps && next.distance < previous.distance) costs.set(neighbor, next);
    }
  }
}

export function directionalNeighbor(slots: readonly Slot[], id: string, key: string) {
  const source = slots.find(slot => slot.id === id);
  if (!source) return undefined;
  const neighbors = adjacentSlots(slots).get(id)!;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  return slots.filter(slot => neighbors.has(slot.id) && (horizontal
    ? (slot.left - source.left) * sign > 1
    : Math.abs(slot.left - source.left) < 1 && (slot.top - source.top) * sign > 1))
    .sort((a, b) => horizontal ? Math.abs(centerY(a) - centerY(source)) - Math.abs(centerY(b) - centerY(source))
      : Math.abs(a.top - source.top) - Math.abs(b.top - source.top))[0]?.id;
}
