// Cross-link routing: each link is path-found on a grid around the map, so it
// can bend around any number of topics instead of following a fixed arc.
//
// 1. Every topic is a wall (with a small margin).
// 2. Branch lines and links already drawn cost extra, so links keep off them.
// 3. A* finds the cheapest route between the sides of the two topics.
// 4. The route is pulled tight (straight segments wherever the way is clear)
//    and drawn with rounded corners.

import { Box, edgeSamples, linkPath } from "./layout";

export interface LinkReq {
  from: string;
  to: string;
  /** Text shown on the link. */
  label?: string;
}

type Pt = [number, number];

const MARGIN = 6; // clearance around topics
const STUB = 13; // straight bit where a link leaves / enters a topic
const RADIUS = 26; // corner rounding

interface Port {
  border: Pt; // point on the topic's edge
  out: Pt; // point just outside, where routing starts/ends
  dir: Pt; // outward direction
}

function ports(b: Box): Port[] {
  const cx = b.x + b.w / 2,
    cy = b.y + b.h / 2;
  const sides: Port[] = [
    { border: [cx, b.y - 2], out: [cx, b.y - STUB], dir: [0, -1] },
    { border: [cx, b.y + b.h + 2], out: [cx, b.y + b.h + STUB], dir: [0, 1] },
    { border: [b.x - 2, cy], out: [b.x - STUB, cy], dir: [-1, 0] },
    { border: [b.x + b.w + 2, cy], out: [b.x + b.w + STUB, cy], dir: [1, 0] },
  ];
  // Extra ports on the left and right of taller topics.
  if (b.h >= 30) {
    for (const fy of [0.28, 0.72]) {
      const y = b.y + b.h * fy;
      sides.push({ border: [b.x - 2, y], out: [b.x - STUB, y], dir: [-1, 0] });
      sides.push({ border: [b.x + b.w + 2, y], out: [b.x + b.w + STUB, y], dir: [1, 0] });
    }
  }
  // Extra ports along the top and bottom so links can slip into narrow gaps.
  if (b.w > 36) {
    for (const fx of b.w > 140 ? [0.15, 0.3, 0.7, 0.85] : [0.25, 0.75]) {
      const x = b.x + b.w * fx;
      sides.push({ border: [x, b.y - 2], out: [x, b.y - STUB], dir: [0, -1] });
      sides.push({ border: [x, b.y + b.h + 2], out: [x, b.y + b.h + STUB], dir: [0, 1] });
    }
  }
  return sides;
}

/** Min-heap keyed by f-score. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k,
      v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): number {
    const k = this.k,
      v = this.v;
    const top = v[0];
    const lk = k.pop()!,
      lv = v.pop()!;
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

/** Small things on the map that links must not cross (e.g. fold dots). */
export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function routeLinks(boxes: Map<string, Box>, links: LinkReq[], extra: Obstacle[] = []): string[] {
  const all = [...boxes.values()];
  if (!links.length || !all.length) return [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of all) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const PAD = 140;
  const ox = minX - PAD,
    oy = minY - PAD;
  const W = maxX - minX + 2 * PAD,
    H = maxY - minY + 2 * PAD;
  let C = 6;
  while ((W / C) * (H / C) > 160_000) C += 2;
  const cols = Math.ceil(W / C),
    rows = Math.ceil(H / C);
  const N = cols * rows;
  const blocked = new Uint8Array(N);
  const soft = new Float32Array(N);
  const idx = (x: number, y: number) => {
    const cx = Math.floor((x - ox) / C),
      cy = Math.floor((y - oy) / C);
    return cx < 0 || cy < 0 || cx >= cols || cy >= rows ? -1 : cy * cols + cx;
  };
  const center = (i: number): Pt => [ox + ((i % cols) + 0.5) * C, oy + (Math.floor(i / cols) + 0.5) * C];

  // Walls: every topic (and fold dot), by cell centre.
  for (const b of [...all, ...extra]) {
    const x0 = Math.max(0, Math.floor((b.x - MARGIN - ox) / C)),
      x1 = Math.min(cols - 1, Math.ceil((b.x + b.w + MARGIN - ox) / C));
    const y0 = Math.max(0, Math.floor((b.y - MARGIN - oy) / C)),
      y1 = Math.min(rows - 1, Math.ceil((b.y + b.h + MARGIN - oy) / C));
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const px = ox + (cx + 0.5) * C,
          py = oy + (cy + 0.5) * C;
        if (px > b.x - MARGIN && px < b.x + b.w + MARGIN && py > b.y - MARGIN && py < b.y + b.h + MARGIN) blocked[cy * cols + cx] = 1;
      }
  }
  // Branch lines cost extra (crossing one is fine, running along it is not).
  const addSoft = (x: number, y: number, v: number, spread: number) => {
    for (let dy = -spread; dy <= spread; dy++)
      for (let dx = -spread; dx <= spread; dx++) {
        const i = idx(x + dx * C, y + dy * C);
        if (i >= 0) soft[i] = Math.max(soft[i], v);
      }
  };
  for (const b of all) {
    if (!b.parent) continue;
    const p = boxes.get(b.parent);
    if (p) for (const [x, y] of edgeSamples(p, b, 32)) addSoft(x, y, 14, 1);
  }

  // Is the straight segment a→b clear of walls (and not along a branch)?
  const clear = (a: Pt, b: Pt) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / (C / 2)));
    let softHits = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const i = idx(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (i < 0 || blocked[i]) return false;
      if (soft[i] >= 10) softHits++;
    }
    return softHits <= 3; // allow crossing a branch, not following it
  };

  const out: string[] = new Array(links.length).fill("");
  const usedPorts = new Set<number>();
  // Short links first: they have the fewest ways around, long ones can detour.
  const order = links
    .map((L, k) => {
      const a = boxes.get(L.from),
        b = boxes.get(L.to);
      const d = a && b ? Math.abs(a.x + a.w / 2 - b.x - b.w / 2) + Math.abs(a.y + a.h / 2 - b.y - b.h / 2) : 0;
      return { L, k, d };
    })
    .sort((x, y) => x.d - y.d);
  for (const { L, k } of order) {
    const a = boxes.get(L.from),
      b = boxes.get(L.to);
    if (!a || !b) continue;
    // Each entry/exit point is used by one link only, so arrowheads never stack.
    const free = (p: Port) => {
      const i = idx(...p.out);
      return i >= 0 && !blocked[i] && !usedPorts.has(i);
    };
    let pa = ports(a).filter(free);
    let pb = ports(b).filter(free);
    if (!pa.length) pa = ports(a).filter((p) => idx(...p.out) >= 0 && !blocked[idx(...p.out)]);
    if (!pb.length) pb = ports(b).filter((p) => idx(...p.out) >= 0 && !blocked[idx(...p.out)]);
    const route = pa.length && pb.length ? astar(pa, pb, a, b) : null;
    if (!route) {
      out[k] = linkPath(a, b);
      continue;
    }
    // Later links must not share this one's line (crossing it is fine).
    for (const [x, y] of densify(route.pts, C)) addSoft(x, y, 12, 1);
    for (const p of [route.from, route.to]) {
      // Reserve the port and its neighbours so the next arrow lands clearly apart.
      for (const dx of [-C, 0, C]) for (const dy of [-C, 0, C]) {
        const i = idx(p.out[0] + dx, p.out[1] + dy);
        if (i >= 0) usedPorts.add(i);
      }
    }
    out[k] = roundedPath([route.from.border, route.from.out, ...route.pts.slice(1, -1), route.to.out, route.to.border]);
  }
  return out;

  function astar(pa: Port[], pb: Port[], a: Box, b: Box): { from: Port; to: Port; pts: Pt[] } | null {
    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const startPort = new Int16Array(N).fill(-1);
    const goal = new Map<number, number>();
    pb.forEach((p, k) => goal.set(idx(...p.out), k));
    const bc: Pt = [b.x + b.w / 2, b.y + b.h / 2],
      ac: Pt = [a.x + a.w / 2, a.y + a.h / 2];
    const goalCells = [...goal.keys()].map(center);
    // Arriving on a branch line costs extra too.
    const arrive = new Map<number, number>();
    for (const k of goal.keys()) arrive.set(k, Math.min(soft[k], 14) * 3 + (usedPorts.has(k) ? 400 : 0));
    const h = (i: number) => {
      const [x, y] = center(i);
      let best = Infinity;
      for (const [gx, gy] of goalCells) {
        const dx = Math.abs(gx - x) / C,
          dy = Math.abs(gy - y) / C;
        best = Math.min(best, Math.max(dx, dy) + 0.414 * Math.min(dx, dy));
      }
      return best;
    };
    const heap = new Heap();
    pa.forEach((p, k) => {
      const i = idx(...p.out);
      // Prefer sides that face the other topic.
      // Ports that sit on a branch line are a last resort.
      const facing = (p.dir[0] * (bc[0] - ac[0]) + p.dir[1] * (bc[1] - ac[1]) > 0 ? 0 : 6) + Math.min(soft[i], 14) * 3 + (usedPorts.has(i) ? 400 : 0);
      if (facing < g[i]) {
        g[i] = facing;
        startPort[i] = k;
        heap.push(facing + h(i), i);
      }
    });
    const D = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
    ];
    let found = -1;
    let iter = 0;
    const arrived: Record<number, boolean> = {};
    const done = new Uint8Array(N);
    while (heap.size && iter++ < 400_000) {
      const i = heap.pop();
      if (done[i]) continue;
      done[i] = 1;
      if (goal.has(i)) {
        // Charge the arrival cost once; if that makes another goal cheaper, keep searching.
        const extra = arrive.get(i)!;
        if (extra > 0 && !(i in arrived)) {
          arrived[i] = true;
          done[i] = 0;
          heap.push(g[i] + extra, i);
          g[i] += extra;
          continue;
        }
        found = i;
        break;
      }
      const cx = i % cols,
        cy = (i - cx) / cols;
      for (const [dx, dy, len] of D) {
        const nx = cx + dx,
          ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (blocked[j]) continue;
        if (dx && dy && (blocked[cy * cols + nx] || blocked[ny * cols + cx])) continue; // no corner cutting
        const ng = g[i] + len * (1 + soft[j]);
        if (ng < g[j]) {
          g[j] = ng;
          prev[j] = i;
          startPort[j] = startPort[i];
          heap.push(ng + h(j), j);
        }
      }
    }
    if (found < 0) return null;
    const cells: number[] = [];
    for (let i = found; i >= 0; i = prev[i]) cells.push(i);
    cells.reverse();
    const from = pa[startPort[found]],
      to = pb[goal.get(found)!];
    // Pull the path tight: from each point jump to the farthest point still in clear view.
    const raw: Pt[] = [from.out, ...cells.slice(1, -1).map(center), to.out];
    const pts: Pt[] = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !clear(raw[i], raw[j])) j--;
      pts.push(raw[j]);
      i = j;
    }
    return { from, to, pts };
  }
}

/** Points every `step` px along a polyline. */
function densify(p: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < p.length; i++) {
    const [ax, ay] = p[i - 1],
      [bx, by] = p[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Polyline with rounded corners. */
function roundedPath(p: Pt[]): string {
  // Drop points that are (nearly) on a straight line.
  const q: Pt[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    const a = q[q.length - 1],
      b = p[i],
      c = p[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1 && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) q.push(b);
  }
  q.push(p[p.length - 1]);
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(q[0][0])},${f(q[0][1])}`;
  for (let i = 1; i < q.length - 1; i++) {
    const a = q[i - 1],
      b = q[i],
      c = q[i + 1];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]),
      l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const r = Math.min(RADIUS, l1 / 2, l2 / 2);
    const p1: Pt = [b[0] - ((b[0] - a[0]) / l1) * r, b[1] - ((b[1] - a[1]) / l1) * r];
    const p2: Pt = [b[0] + ((c[0] - b[0]) / l2) * r, b[1] + ((c[1] - b[1]) / l2) * r];
    d += ` L${f(p1[0])},${f(p1[1])} Q${f(b[0])},${f(b[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  const z = q[q.length - 1];
  d += ` L${f(z[0])},${f(z[1])}`;
  return d;
}
