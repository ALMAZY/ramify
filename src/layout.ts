import { MapNode } from "./model";

export type LayoutKind = "mindmap" | "right" | "left" | "down";
export const LAYOUTS: { id: LayoutKind; name: string }[] = [
  { id: "mindmap", name: "Mind map" },
  { id: "right", name: "Tree → right" },
  { id: "left", name: "Tree ← left" },
  { id: "down", name: "Org chart ↓" },
];

export interface Box {
  x: number; // left
  y: number; // top
  w: number;
  h: number;
  side: 1 | -1; // 1 = grows right, -1 = grows left
  down?: boolean; // org-chart layout: grows downward
  stack?: boolean; // org-chart layout: part of an indented list under a branch
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
  if (kind === "down") return layoutDown(top, sz, kids);
  if (kind === "right") {
    rootBox.x = 0;
    placeChildren(k, rs.w + H_GAP, 0, 1, 1, top.id);
  } else if (kind === "left") {
    rootBox.x = -rs.w;
    rootBox.side = -1;
    placeChildren(k, -rs.w - H_GAP, 0, -1, 1, top.id);
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

const D_HGAP = 28;
const D_VGAP = 46;
const S_INDENT = 22; // indent per level in the stacked columns
const S_GAP = 14;

/**
 * Org chart: the central topic on top, main branches in a row below it, and
 * everything deeper as an indented list under its branch (compact, like XMind's
 * "org chart" style). Stacked boxes are marked `stack` for elbow edges.
 */
function layoutDown(top: MapNode, sz: (n: MapNode) => Size, kids: (n: MapNode) => MapNode[]): Map<string, Box> {
  const out = new Map<string, Box>();
  // Column = a main branch with its whole subtree stacked below it.
  const colWidth = (n: MapNode): number => {
    let w = sz(n).w;
    const rec = (x: MapNode, d: number) => kids(x).forEach((c) => (w = Math.max(w, d * S_INDENT + sz(c).w), rec(c, d + 1)));
    rec(n, 1);
    return w;
  };
  const rs = sz(top);
  out.set(top.id, { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: 1, down: true, depth: 0, parent: null });
  const cols = kids(top);
  const widths = cols.map(colWidth);
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, cols.length - 1) * D_HGAP;
  const rowH = Math.max(0, ...cols.map((c) => sz(c).h));
  const y1 = rs.h / 2 + D_VGAP;
  let x = -total / 2;
  cols.forEach((c, i) => {
    const s = sz(c);
    const bx = x; // branch box left-aligned in its column
    out.set(c.id, { x: bx, y: y1 + (rowH - s.h) / 2, w: s.w, h: s.h, side: 1, down: true, depth: 1, parent: top.id });
    let y = y1 + rowH + S_GAP + 6;
    const rec = (p: MapNode, d: number) => {
      for (const k of kids(p)) {
        const ks = sz(k);
        out.set(k.id, { x: bx + (d - 1) * S_INDENT, y, w: ks.w, h: ks.h, side: 1, stack: true, depth: d, parent: p.id });
        y += ks.h + S_GAP;
        rec(k, d + 1);
      }
    };
    rec(c, 2);
    x += widths[i] + D_HGAP;
  });
  return out;
}

/** Cubic edge from parent box to child box. */
export function edgePath(p: Box, c: Box): string {
  if (c.stack) {
    // Elbow from the parent's lower-left corner down and across to the child.
    const x1 = p.x + Math.min(12, p.w / 2),
      y1 = p.y + p.h,
      y2 = c.y + c.h / 2,
      x2 = c.x;
    const r = Math.min(8, Math.abs(y2 - y1), Math.abs(x2 - x1));
    return `M${x1},${y1} V${y2 - r} Q${x1},${y2} ${x1 + r},${y2} H${x2}`;
  }
  if (c.down) {
    const x1 = p.x + p.w / 2,
      y1 = p.y + p.h,
      x2 = c.x + c.w / 2,
      y2 = c.y;
    const dy = (y2 - y1) * 0.5;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  }
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

type Pt = [number, number];
type Route = { d: string; pts: [Pt, Pt, Pt, Pt] };

function cubicAt(p: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * u * u * t,
    c = 3 * u * t * t,
    d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

/** How many topics a route passes through (sampled). The two linked topics count
 *  too, except right where the route leaves and arrives. */
function hits(route: Route, obstacles: Box[], a: Box, b: Box): number {
  let n = 0;
  for (const o of obstacles) {
    const own = o === a || o === b;
    for (let i = own ? 7 : 1; i < (own ? 33 : 40); i++) {
      const [x, y] = cubicAt(route.pts, i / 40);
      if (x > o.x - 6 && x < o.x + o.w + 6 && y > o.y - 6 && y < o.y + o.h + 6) {
        n++;
        break;
      }
    }
  }
  return n;
}

/**
 * Cross-link from box a to box b, routed clear of the tree and of other topics.
 * Tries arcs over, under, left and right at a few heights and keeps the one that
 * crosses the fewest topics (ties go to the natural direction and the tightest arc).
 * `lane` (0, 1, 2…) pushes repeated links between the same pair further out.
 */
export function linkPath(a: Box, b: Box, lane = 0, obstacles: Box[] = []): string {
  const acx = a.x + a.w / 2,
    acy = a.y + a.h / 2,
    bcx = b.x + b.w / 2,
    bcy = b.y + b.h / 2;
  const dx = bcx - acx,
    dy = bcy - acy;
  const GAP = 4; // keep the arrowhead just outside the box
  const sx = Math.sign(dx) || 1;
  const sideways = Math.abs(dx) >= Math.abs(dy) * 0.6;
  const base = (d: number) => Math.min(130, Math.max(34, Math.abs(d) * 0.35)) + lane * 22;
  const routes: { r: Route; pref: number }[] = [];
  for (const extra of [0, 34, 70]) {
    // over the top
    {
      const x1 = acx + sx * Math.min(a.w / 4, 24), y1 = a.y - GAP / 2;
      const x2 = bcx - sx * Math.min(b.w / 4, 24), y2 = b.y - GAP;
      const cy = Math.min(y1, y2) - base(dx) - extra;
      routes.push({ r: { d: "", pts: [[x1, y1], [x1, cy], [x2, cy], [x2, y2]] }, pref: (sideways ? 0 : 3) + extra / 34 });
    }
    // under the bottom
    {
      const x1 = acx + sx * Math.min(a.w / 4, 24), y1 = a.y + a.h + GAP / 2;
      const x2 = bcx - sx * Math.min(b.w / 4, 24), y2 = b.y + b.h + GAP;
      const cy = Math.max(y1, y2) + base(dx) + extra;
      routes.push({ r: { d: "", pts: [[x1, y1], [x1, cy], [x2, cy], [x2, y2]] }, pref: (sideways ? 1 : 3) + extra / 34 });
    }
    // out to the right
    {
      const x1 = a.x + a.w + GAP / 2, y1 = acy;
      const x2 = b.x + b.w + GAP, y2 = bcy;
      const cx = Math.max(x1, x2) + base(dy) + extra;
      routes.push({ r: { d: "", pts: [[x1, y1], [cx, y1], [cx, y2], [x2, y2]] }, pref: (sideways ? 3 : 0) + extra / 34 });
    }
    // out to the left
    {
      const x1 = a.x - GAP / 2, y1 = acy;
      const x2 = b.x - GAP, y2 = bcy;
      const cx = Math.min(x1, x2) - base(dy) - extra;
      routes.push({ r: { d: "", pts: [[x1, y1], [cx, y1], [cx, y2], [x2, y2]] }, pref: (sideways ? 3 : 1) + extra / 34 });
    }
  }
  let best = routes[0];
  let bestScore = Infinity;
  for (const c of routes) {
    const score = hits(c.r, obstacles, a, b) * 10 + c.pref;
    if (score < bestScore) (bestScore = score), (best = c);
  }
  const [p0, p1, p2, p3] = best.r.pts;
  return `M${r(p0[0])},${r(p0[1])} C${r(p1[0])},${r(p1[1])} ${r(p2[0])},${r(p2[1])} ${r(p3[0])},${r(p3[1])}`;
}

const r = (v: number) => Math.round(v * 10) / 10;

/** Points along a tree edge (used to keep cross-links off the branch lines). */
export function edgeSamples(p: Box, c: Box, n = 16): [number, number][] {
  const out: [number, number][] = [];
  if (c.stack) {
    const x1 = p.x + Math.min(12, p.w / 2),
      y1 = p.y + p.h,
      y2 = c.y + c.h / 2,
      x2 = c.x;
    for (let i = 0; i <= n; i++) out.push([x1, y1 + ((y2 - y1) * i) / n]);
    for (let i = 0; i <= n / 2; i++) out.push([x1 + ((x2 - x1) * i) / (n / 2), y2]);
    return out;
  }
  let pts: [number, number][];
  if (c.down) {
    const x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y, dy = (y2 - y1) * 0.5;
    pts = [[x1, y1], [x1, y1 + dy], [x2, y2 - dy], [x2, y2]];
  } else {
    const x1 = c.side === 1 ? p.x + p.w : p.x, y1 = p.y + p.h / 2, x2 = c.side === 1 ? c.x : c.x + c.w, y2 = c.y + c.h / 2, dx = (x2 - x1) * 0.5;
    pts = [[x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2]];
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * pts[0][0] + 3 * u * u * t * pts[1][0] + 3 * u * t * t * pts[2][0] + t * t * t * pts[3][0],
      u * u * u * pts[0][1] + 3 * u * u * t * pts[1][1] + 3 * u * t * t * pts[2][1] + t * t * t * pts[3][1],
    ]);
  }
  return out;
}
