/**
 * Removal dependency graph (spec §35).
 *
 *   SOURCE (broker page) → search-engine appearances → cached/secondary indexes
 *
 * Edges are parent_record_id links. When an origin is removed, every
 * downstream node needs a verification check; removal work should always be
 * ordered origin-first.
 */
export interface GraphNode {
  id: string;
  parentId: string | null;
}

export function childrenIndex(nodes: GraphNode[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = idx.get(n.parentId) ?? [];
    list.push(n.id);
    idx.set(n.parentId, list);
  }
  return idx;
}

/** All transitive downstream ids (breadth-first, cycle-safe). */
export function downstreamOf(rootId: string, nodes: GraphNode[]): string[] {
  const idx = childrenIndex(nodes);
  const out: string[] = [];
  const seen = new Set([rootId]);
  const queue = [...(idx.get(rootId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(idx.get(id) ?? []));
  }
  return out;
}

/** Topological order with origins first (Kahn's algorithm; orphans treated as roots). */
export function removalOrder(nodes: GraphNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const idx = childrenIndex(nodes);
  const roots = nodes.filter((n) => !n.parentId || !ids.has(n.parentId)).map((n) => n.id);
  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    queue.push(...(idx.get(id) ?? []));
  }
  for (const n of nodes) if (!seen.has(n.id)) order.push(n.id); // cycles, defensively
  return order;
}
