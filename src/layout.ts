import { MapNode } from "./model";

export type LayoutKind = "right" | "mindmap";

export interface Box {
  x: number; // left
  y: number; // top
  w: number;
  h: number;
  side: 1 | -1; // 1 = grows right, -1 = grows left
  depth: number;
  parent: string | null;
}

export interface Size {
  w: number;
  h: number;
}

const H_GAP = 44;
const V_GAP = 8;
const BRANCH_GAP = 14; // extra space between sibling branches that have children

export function layout(top: MapNode, sizes: Map<string, Size>, kind: LayoutKind): Map<string, Box> {
  const out = new Map<string, Box>();
  const sz = (n: MapNode) => sizes.get(n.id) ?? { w: 80, h: 30 };
  const kids = (n: MapNode) => (n.collapsed ? [] : n.children);

  const heightMemo = new Map<string, number>();
  const subH = (n: MapNode): number => {
    const m = heightMemo.get(n.id);
    if (m !== undefined) return m;
    const k = kids(n);
    const own = sz(n).h;
    let ch = 0;
    k.forEach((c, i) => {
      ch += subH(c);
      if (i) ch += V_GAP + (c.children.length && !c.collapsed ? BRANCH_GAP : 0);
    });
    const v = Math.max(own, ch);
    heightMemo.set(n.id, v);
    return v;
  };

  const blockH = (list: MapNode[]) => {
    let h = 0;
    list.forEach((c, i) => {
      h += subH(c);
      if (i) h += V_GAP + (c.children.length && !c.collapsed ? BRANCH_GAP : 0);
    });
    return h;
  };

  // Place a list of children whose parent edge is at `edgeX` and centered on `cy`.
  const placeChildren = (list: MapNode[], edgeX: number, cy: number, side: 1 | -1, depth: number, parentId: string) => {
    let y = cy - blockH(list) / 2;
    list.forEach((c, i) => {
      if (i) y += V_GAP + (c.children.length && !c.collapsed ? BRANCH_GAP : 0);
      const h = subH(c);
      place(c, edgeX, y + h / 2, side, depth, parentId);
      y += h;
    });
  };

  const place = (n: MapNode, edgeX: number, cy: number, side: 1 | -1, depth: number, parentId: string | null) => {
    const s = sz(n);
    const x = side === 1 ? edgeX : edgeX - s.w;
    out.set(n.id, { x, y: cy - s.h / 2, w: s.w, h: s.h, side, depth, parent: parentId });
    const k = kids(n);
    if (!k.length) return;
    const childEdge = side === 1 ? x + s.w + H_GAP : x - H_GAP;
    placeChildren(k, childEdge, cy, side, depth + 1, n.id);
  };

  const rs = sz(top);
  const rootBox: Box = { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: 1, depth: 0, parent: null };
  out.set(top.id, rootBox);
  const k = kids(top);
  if (kind === "right") {
    rootBox.x = 0;
    placeChildren(k, rs.w + H_GAP, 0, 1, 1, top.id);
  } else {
    // Balanced: fill right side until it holds about half the total height.
    const total = blockH(k);
    const right: MapNode[] = [];
    const left: MapNode[] = [];
    let acc = 0;
    for (const c of k) {
      if (acc < total / 2 || right.length === 0) {
        right.push(c);
        acc += subH(c) + V_GAP;
      } else left.push(c);
    }
    placeChildren(right, rs.w / 2 + H_GAP, 0, 1, 1, top.id);
    placeChildren(left, -rs.w / 2 - H_GAP, 0, -1, 1, top.id);
  }
  return out;
}

/** Cubic edge from parent box to child box. */
export function edgePath(p: Box, c: Box): string {
  const side = c.side;
  const x1 = side === 1 ? p.x + p.w : p.x;
  const y1 = p.y + p.h / 2;
  const x2 = side === 1 ? c.x : c.x + c.w;
  const y2 = c.y + c.h / 2;
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function bounds(boxes: Iterable<Box>) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
