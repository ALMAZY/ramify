import { MapNode } from "./model";

export type LayoutKind = "mindmap" | "right" | "left" | "down" | "timeline" | "brace";
export const LAYOUTS: { id: LayoutKind; name: string }[] = [
  { id: "mindmap", name: "Mind map" },
  { id: "right", name: "Tree → right" },
  { id: "left", name: "Tree ← left" },
  { id: "down", name: "Org chart ↓" },
  { id: "timeline", name: "Timeline ↓" },
  { id: "brace", name: "Brace map" },
];

export type LineStyle = "curved" | "elbow" | "straight";
export const LINE_STYLES: { id: LineStyle; name: string }[] = [
  { id: "curved", name: "Curved" },
  { id: "elbow", name: "Elbow" },
  { id: "straight", name: "Straight" },
];
let lineStyle: LineStyle = "curved";
/** Branch line style for edgePath / edgeSamples (set by the map view before drawing). */
export function setLineStyle(s: LineStyle) {
  lineStyle = s;
}

export interface Box {
  x: number; // left
  y: number; // top
  w: number;
  h: number;
  side: 1 | -1; // 1 = grows right, -1 = grows left
  /** Timeline layout: x of the vertical line the main topics hang from. */
  spine?: number;
  /** Brace map: x of the bracket that joins this topic to its siblings, and the bracket's extent. */
  bracket?: { x: number; y1: number; y2: number; first: boolean };
  down?: boolean; // org-chart layout: grows downward
  stack?: boolean; // org-chart layout: part of an indented list under a branch
  depth: number;
  parent: string | null;
  /** Summary topic: drawn with a brace over the siblings it sums up instead of a branch line. */
  brace?: { x: number; y1: number; y2: number };
}

export const B_PAD = 9; // space between a boundary and what it wraps
export const B_LABEL = 22; // room for a boundary's label
const BRACE = 30; // brace width + gap before the summary topic
/** Extra room a boundary needs above / below its branch. */
function bExtra(n: MapNode) {
  if (n.boundary === undefined) return { top: 0, bot: 0 };
  return { top: B_PAD + (n.boundary ? B_LABEL : 0), bot: B_PAD };
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
    const own = sz(n).h;
    const ex = bExtra(n);
    const v = Math.max(own, blockH(kids(n))) + ex.top + ex.bot;
    heightMemo.set(n.id, v);
    return v;
  };

  // Summary topics sit beside the siblings they sum up, so they take no room in the stack.
  const blockH = (list: MapNode[]) => {
    let h = 0;
    list
      .filter((c) => !c.summary)
      .forEach((c, i) => {
        h += subH(c);
        if (i) h += V_GAP + (c.children.length && !c.collapsed ? BRANCH_GAP : 0);
      });
    return h;
  };

  /** Bounding box of the boxes placed so far for a branch (topic + visible descendants). */
  const branchBox = (n: MapNode) => {
    let x1 = Infinity,
      y1 = Infinity,
      x2 = -Infinity,
      y2 = -Infinity;
    const rec = (x: MapNode) => {
      const b = out.get(x.id);
      if (b) {
        x1 = Math.min(x1, b.x);
        y1 = Math.min(y1, b.y);
        x2 = Math.max(x2, b.x + b.w);
        y2 = Math.max(y2, b.y + b.h);
      }
      kids(x).forEach(rec);
    };
    rec(n);
    const ex = n.boundary !== undefined;
    return ex ? { x1: x1 - B_PAD, y1: y1 - B_PAD - (n.boundary ? B_LABEL : 0), x2: x2 + B_PAD, y2: y2 + B_PAD } : { x1, y1, x2, y2 };
  };

  // Place a list of children whose parent edge is at `edgeX` and centered on `cy`.
  const placeChildren = (list: MapNode[], edgeX: number, cy: number, side: 1 | -1, depth: number, parentId: string, all: MapNode[] = list) => {
    let y = cy - blockH(list) / 2;
    let first = true;
    for (const c of list) {
      if (c.summary) continue;
      if (!first) y += V_GAP + (c.children.length && !c.collapsed ? BRANCH_GAP : 0);
      first = false;
      const h = subH(c);
      const ex = bExtra(c);
      place(c, edgeX, y + ex.top + (h - ex.top - ex.bot) / 2, side, depth, parentId);
      y += h;
    }
    for (const s of list) {
      if (!s.summary) continue;
      // The `summary` ordinary siblings just before it (in the full child list).
      const i = all.indexOf(s);
      const covered: MapNode[] = [];
      for (let j = i - 1; j >= 0 && covered.length < s.summary; j--) if (!all[j].summary) covered.push(all[j]);
      const boxes = covered.filter((c) => out.has(c.id)).map(branchBox);
      if (!boxes.length) {
        place(s, edgeX, cy, side, depth, parentId);
        continue;
      }
      const y1 = Math.min(...boxes.map((b) => b.y1)),
        y2 = Math.max(...boxes.map((b) => b.y2));
      const bx = side === 1 ? Math.max(...boxes.map((b) => b.x2)) + 6 : Math.min(...boxes.map((b) => b.x1)) - 6;
      place(s, bx + side * BRACE, (y1 + y2) / 2, side, depth, parentId);
      out.get(s.id)!.brace = { x: bx, y1, y2 };
    }
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

  // Brace map: one bracket per family instead of one line per child.
  const markBrackets = () => {
    const fam = new Map<string, Box[]>();
    for (const b of out.values()) if (b.parent && !b.brace) fam.set(b.parent, [...(fam.get(b.parent) ?? []), b]);
    for (const [, list] of fam) {
      const ys = list.map((b) => b.y + b.h / 2);
      const side = list[0].side;
      const x = side === 1 ? Math.min(...list.map((b) => b.x)) - 16 : Math.max(...list.map((b) => b.x + b.w)) + 16;
      list.forEach((b, i) => (b.bracket = { x, y1: Math.min(...ys), y2: Math.max(...ys), first: i === 0 }));
    }
  };

  const rs = sz(top);
  const rootBox: Box = { x: -rs.w / 2, y: -rs.h / 2, w: rs.w, h: rs.h, side: 1, depth: 0, parent: null };
  out.set(top.id, rootBox);
  const k = kids(top);
  if (kind === "down") return layoutDown(top, sz, kids);
  if (kind === "timeline") {
    // Root on top; main topics hang from a vertical line, their branches grow right.
    rootBox.x = 0;
    const spine = Math.min(rs.w / 2, 40);
    let y = rs.h / 2 + 34;
    for (const c of k) {
      if (c.summary) continue;
      const h = subH(c);
      const ex = bExtra(c);
      place(c, spine + 34, y + ex.top + (h - ex.top - ex.bot) / 2, 1, 1, top.id);
      out.get(c.id)!.spine = spine;
      y += h + 26;
    }
    placeChildren(k.filter((c) => c.summary), spine + 34, 0, 1, 1, top.id, k);
    return out;
  }
  if (kind === "right" || kind === "brace") {
    rootBox.x = 0;
    placeChildren(k, rs.w + H_GAP, 0, 1, 1, top.id);
    if (kind === "brace") markBrackets();
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
    let last: MapNode[] = right;
    for (const c of k) {
      if (c.summary) {
        last.push(c); // a summary stays on the side of the topics it sums up
        continue;
      }
      if (acc < total / 2 || right.length === 0) {
        right.push(c);
        acc += subH(c) + V_GAP;
        last = right;
      } else {
        left.push(c);
        last = left;
      }
    }
    placeChildren(right, rs.w / 2 + H_GAP, 0, 1, 1, top.id, k);
    placeChildren(left, -rs.w / 2 - H_GAP, 0, -1, 1, top.id, k);
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
        const ex = bExtra(k);
        y += ex.top;
        out.set(k.id, { x: bx + (d - 1) * S_INDENT, y, w: ks.w, h: ks.h, side: 1, stack: true, depth: d, parent: p.id });
        y += ks.h + S_GAP;
        rec(k, d + 1);
        y += ex.bot;
      }
    };
    rec(c, 2);
    x += widths[i] + D_HGAP;
  });
  return out;
}

/** Curly brace for a summary topic (it opens towards the topics it sums up). */
function bracePath(c: Box): string {
  const { x, y1, y2 } = c.brace!;
  const s = c.side;
  const w = 7 * s;
  const mid = (y1 + y2) / 2;
  const r = Math.min(8, (y2 - y1) / 4);
  return `M${x},${y1} Q${x + w},${y1} ${x + w},${y1 + r} V${mid - r} Q${x + w},${mid} ${x + 2 * w},${mid} Q${x + w},${mid} ${x + w},${mid + r} V${y2 - r} Q${x + w},${y2} ${x},${y2} M${x + 2 * w},${mid} H${s === 1 ? c.x : c.x + c.w}`;
}

/** Boxes (map coordinates) for the dashed boundaries around branches. */
export function boundaryBoxes(top: MapNode, boxes: Map<string, Box>): { id: string; x: number; y: number; w: number; h: number; label: string }[] {
  const out: { id: string; x: number; y: number; w: number; h: number; label: string }[] = [];
  const rec = (n: MapNode) => {
    if (n.boundary !== undefined && n !== top && boxes.has(n.id)) {
      let x1 = Infinity,
        y1 = Infinity,
        x2 = -Infinity,
        y2 = -Infinity;
      const walkB = (x: MapNode) => {
        const b = boxes.get(x.id);
        if (!b) return;
        x1 = Math.min(x1, b.x);
        y1 = Math.min(y1, b.y);
        x2 = Math.max(x2, b.x + b.w);
        y2 = Math.max(y2, b.y + b.h);
        if (!x.collapsed) x.children.forEach(walkB);
      };
      walkB(n);
      const top = y1 - B_PAD - (n.boundary ? B_LABEL : 0);
      out.push({ id: n.id, x: x1 - B_PAD, y: top, w: x2 - x1 + 2 * B_PAD, h: y2 + B_PAD - top, label: n.boundary });
    }
    if (!n.collapsed) n.children.forEach(rec);
  };
  rec(top);
  return out;
}

/** Corner points of an orthogonal line from parent to child (elbow style). */
function elbowPts(p: Box, c: Box): [number, number][] {
  if (c.down || c.stack) {
    // One shared horizontal line under the parent, whatever the children's heights.
    const x1 = p.x + p.w / 2, y1 = p.y + p.h, x2 = c.x + c.w / 2, y2 = c.y, my = y1 + Math.min(D_VGAP / 2, (y2 - y1) / 2);
    return [[x1, y1], [x1, my], [x2, my], [x2, y2]];
  }
  const x1 = c.side === 1 ? p.x + p.w : p.x, y1 = p.y + p.h / 2, x2 = c.side === 1 ? c.x : c.x + c.w, y2 = c.y + c.h / 2;
  const mx = x1 + (x2 - x1) * 0.5;
  return [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
}

function roundedPoly(pts: [number, number][], r = 8): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) {
      d += ` L${bx},${by}`;
      continue;
    }
    d += ` L${bx - ((bx - ax) / l1) * rr},${by - ((by - ay) / l1) * rr} Q${bx},${by} ${bx + ((cx - bx) / l2) * rr},${by + ((cy - by) / l2) * rr}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${lx},${ly}`;
}

/** Edge from parent box to child box, in the map's line style. */
export function edgePath(p: Box, c: Box): string {
  if (c.brace) return bracePath(c);
  if (c.spine !== undefined) {
    // Timeline: down the line from the central topic, then across to the topic.
    const x = p.x + c.spine, y1 = p.y + p.h, y2 = c.y + c.h / 2;
    return roundedPoly([[x, y1], [x, y2], [c.x, y2]], 10);
  }
  if (c.bracket) {
    const { x, y1, y2, first } = c.bracket;
    const cy = c.y + c.h / 2;
    const x2 = c.side === 1 ? c.x : c.x + c.w;
    let d = `M${x},${cy} H${x2}`;
    if (first) {
      // The bracket itself plus the line from the parent to its middle.
      const s = c.side;
      const px = s === 1 ? p.x + p.w : p.x, py = p.y + p.h / 2, mid = (y1 + y2) / 2;
      const r = Math.min(8, (y2 - y1) / 4);
      d += y2 - y1 < 2 ? ` M${px},${py} H${x}` : ` M${x + 6 * s},${y1} Q${x},${y1} ${x},${y1 + r} V${mid - r} Q${x},${mid} ${x - 6 * s},${mid} Q${x},${mid} ${x},${mid + r} V${y2 - r} Q${x},${y2} ${x + 6 * s},${y2} M${px},${py} C${(px + x) / 2},${py} ${(px + x) / 2},${mid} ${x - 6 * s},${mid}`;
    }
    return d;
  }
  if (lineStyle === "elbow" || (c.down && !c.stack)) return roundedPoly(elbowPts(p, c));
  if (lineStyle === "straight" && !c.stack) {
    const [a, , , b] = elbowPts(p, c);
    return `M${a[0]},${a[1]} L${b[0]},${b[1]}`;
  }
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
  const poly = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) for (let k = 0; k <= n / 2; k++) out.push([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / (n / 2), pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / (n / 2)]);
    return out;
  };
  if (c.spine !== undefined) return poly([[p.x + c.spine, p.y + p.h], [p.x + c.spine, c.y + c.h / 2], [c.x, c.y + c.h / 2]]);
  if (c.bracket) {
    const { x, y1, y2 } = c.bracket;
    return poly([[x, y1], [x, y2], [x, c.y + c.h / 2], [c.side === 1 ? c.x : c.x + c.w, c.y + c.h / 2]]);
  }
  if (!c.brace && !c.stack && (lineStyle === "elbow" || c.down)) return poly(elbowPts(p, c));
  if (!c.brace && !c.stack && lineStyle === "straight") {
    const [a, , , b] = elbowPts(p, c);
    return poly([a, b]);
  }
  if (c.brace) {
    const { x, y1, y2 } = c.brace;
    for (let i = 0; i <= n; i++) out.push([x + 7 * c.side, y1 + ((y2 - y1) * i) / n]);
    return out;
  }
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
