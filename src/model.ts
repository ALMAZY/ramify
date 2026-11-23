// Tree model for a single map. Pure data + structural operations; no DOM.

export type Task = "todo" | "done" | undefined;
import { ShapeId, SHAPE_IDS } from "./shapes";
export type Shape = ShapeId;
export const SHAPES: Shape[] = SHAPE_IDS;

export interface MapNode {
  id: string;
  text: string;
  note: string;
  task?: Task;
  collapsed?: boolean;
  /** Colour name (see colors.ts) or #hex. Inherited by the branch. */
  color?: string;
  /** Outline shape. Undefined = automatic by level. */
  shape?: Shape;
  /** Short text shown in a bubble next to the topic. */
  callout?: string;
  /** Stable id used as a cross-link target (Obsidian block id: ^anchor). */
  anchor?: string;
  /** Anchors of topics this topic links to. */
  links?: string[];
  /** Text shown on a cross-link, by target anchor. */
  linkLabels?: Record<string, string>;
  /** Task details: progress, priority, dates, who, predecessors. */
  plan?: Plan;
  /** Small tags shown under the topic (roles, owners, categories). */
  labels?: string[];
  /** Dashed box around this topic's branch; the string is its label ("" = no label). */
  boundary?: string;
  /** This topic is a summary of the `summary` siblings just before it (drawn with a brace). */
  summary?: number;
  /** Link to a topic in another map: "folder/map.md#anchor". */
  xref?: string;
  children: MapNode[];
}

export interface Plan {
  /** 0–100. Undefined = worked out from sub-tasks. */
  progress?: number;
  /** 1 (highest) – 5. */
  priority?: number;
  /** ISO dates, YYYY-MM-DD. */
  start?: string;
  due?: string;
  /** Assignee (free text). */
  who?: string;
  /** Anchors of predecessor topics (this task starts after them). */
  after?: string[];
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e9;
  return Date.now().toString(36) + "-" + counter.toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

export function makeNode(text = "", children: MapNode[] = []): MapNode {
  return { id: newId(), text, note: "", children };
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

/** Fresh copy of a subtree with new ids (used for paste / duplicate). Anchors are dropped so they stay unique. */
export function reId(n: MapNode): MapNode {
  const c: MapNode = { ...n, id: newId(), children: n.children.map(reId) };
  delete c.anchor;
  return c;
}

export function newAnchor(root: MapNode): string {
  const used = new Set<string>();
  walk(root, (n) => n.anchor && used.add(n.anchor));
  for (;;) {
    const a = Math.random().toString(36).slice(2, 8);
    if (!used.has(a) && /[a-z]/.test(a)) return a;
  }
}

export function findByAnchor(root: MapNode, anchor: string): MapNode | null {
  let hit: MapNode | null = null;
  walk(root, (n) => {
    if (n.anchor === anchor) hit = n;
  });
  return hit;
}

export interface Loc {
  node: MapNode;
  parent: MapNode | null;
  index: number;
  depth: number;
}

export function find(root: MapNode, id: string): Loc | null {
  if (root.id === id) return { node: root, parent: null, index: 0, depth: 0 };
  const stack: [MapNode, number][] = [[root, 0]];
  while (stack.length) {
    const [p, d] = stack.pop()!;
    for (let i = 0; i < p.children.length; i++) {
      const c = p.children[i];
      if (c.id === id) return { node: c, parent: p, index: i, depth: d + 1 };
      if (c.children.length) stack.push([c, d + 1]);
    }
  }
  return null;
}

export function walk(n: MapNode, fn: (n: MapNode, depth: number, parent: MapNode | null) => void, depth = 0, parent: MapNode | null = null) {
  fn(n, depth, parent);
  for (const c of n.children) walk(c, fn, depth + 1, n);
}

export function isAncestor(root: MapNode, ancestorId: string, id: string): boolean {
  const a = find(root, ancestorId);
  if (!a) return false;
  let hit = false;
  walk(a.node, (n) => {
    if (n.id === id) hit = true;
  });
  return hit;
}

/** Ids of nodes visible in document order (respects collapse), starting at `top`. */
export function visibleOrder(top: MapNode): MapNode[] {
  const out: MapNode[] = [];
  const rec = (n: MapNode) => {
    out.push(n);
    if (!n.collapsed) n.children.forEach(rec);
  };
  rec(top);
  return out;
}

export function pathTo(root: MapNode, id: string): MapNode[] {
  const path: MapNode[] = [];
  const rec = (n: MapNode): boolean => {
    path.push(n);
    if (n.id === id) return true;
    for (const c of n.children) if (rec(c)) return true;
    path.pop();
    return false;
  };
  return rec(root) ? path : [];
}

// ---------- structural ops (mutate in place, return id to select) ----------

export function addChild(root: MapNode, parentId: string, text = "", at?: number): string | null {
  const l = find(root, parentId);
  if (!l) return null;
  const n = makeNode(text);
  l.node.collapsed = false;
  const i = at ?? l.node.children.length;
  l.node.children.splice(i, 0, n);
  return n.id;
}

export function addSibling(root: MapNode, id: string, above = false, text = ""): string | null {
  const l = find(root, id);
  if (!l) return null;
  if (!l.parent) return addChild(root, id, text, above ? 0 : undefined);
  const n = makeNode(text);
  l.parent.children.splice(l.index + (above ? 0 : 1), 0, n);
  return n.id;
}

/** Removes the node. Returns the id that should be selected next. */
export function remove(root: MapNode, id: string): string | null {
  const l = find(root, id);
  if (!l || !l.parent) return null;
  l.parent.children.splice(l.index, 1);
  const sib = l.parent.children[l.index - 1] ?? l.parent.children[l.index];
  return sib ? sib.id : l.parent.id;
}

/** Make node the last child of its previous sibling. */
export function indent(root: MapNode, id: string): boolean {
  const l = find(root, id);
  if (!l || !l.parent || l.index === 0) return false;
  const prev = l.parent.children[l.index - 1];
  l.parent.children.splice(l.index, 1);
  prev.collapsed = false;
  prev.children.push(l.node);
  return true;
}

/** Move node to be the sibling right after its parent. Following siblings stay put. */
export function outdent(root: MapNode, id: string): boolean {
  const l = find(root, id);
  if (!l || !l.parent) return false;
  const pl = find(root, l.parent.id);
  if (!pl || !pl.parent) return false;
  l.parent.children.splice(l.index, 1);
  pl.parent.children.splice(pl.index + 1, 0, l.node);
  return true;
}

export function moveSibling(root: MapNode, id: string, delta: -1 | 1): boolean {
  const l = find(root, id);
  if (!l || !l.parent) return false;
  const j = l.index + delta;
  if (j < 0 || j >= l.parent.children.length) return false;
  const arr = l.parent.children;
  [arr[l.index], arr[j]] = [arr[j], arr[l.index]];
  return true;
}

/** Move `id` under `targetId` (as last child) or before/after it. */
export function moveTo(root: MapNode, id: string, targetId: string, where: "child" | "before" | "after"): boolean {
  if (id === targetId || isAncestor(root, id, targetId)) return false;
  const l = find(root, id);
  if (!l || !l.parent) return false;
  const t = find(root, targetId);
  if (!t) return false;
  if (where !== "child" && !t.parent) return false;
  l.parent.children.splice(l.index, 1);
  if (where === "child") {
    t.node.collapsed = false;
    t.node.children.push(l.node);
  } else {
    const t2 = find(root, targetId)!; // index may have shifted
    t2.parent!.children.splice(t2.index + (where === "after" ? 1 : 0), 0, l.node);
  }
  return true;
}

export function cycleTask(n: MapNode) {
  n.task = n.task === undefined ? "todo" : n.task === "todo" ? "done" : undefined;
}

export function setCollapsedAll(n: MapNode, collapsed: boolean, keepRoot = true) {
  walk(n, (x, d) => {
    if (x.children.length) x.collapsed = keepRoot && d === 0 ? false : collapsed;
  });
}

export function countNodes(n: MapNode): number {
  let c = 0;
  walk(n, () => c++);
  return c;
}

// ---------- undo history ----------

interface Snap {
  root: string;
  sel: string | null;
}

export class History {
  private past: Snap[] = [];
  private future: Snap[] = [];
  constructor(private limit = 300) {}
  push(root: MapNode, sel: string | null) {
    this.pushRaw(JSON.stringify(root), sel);
  }
  pushRaw(rootJson: string, sel: string | null) {
    if (this.past.length && this.past[this.past.length - 1].root === rootJson) return;
    this.past.push({ root: rootJson, sel });
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(cur: MapNode, sel: string | null): Snap | null {
    const s = this.past.pop();
    if (!s) return null;
    this.future.push({ root: JSON.stringify(cur), sel });
    return s;
  }
  redo(cur: MapNode, sel: string | null): Snap | null {
    const s = this.future.pop();
    if (!s) return null;
    this.past.push({ root: JSON.stringify(cur), sel });
    return s;
  }
  /**
   * After an empty topic is dropped: remove the undo steps that only created it,
   * so undo does not bring the empty topic back.
   */
  forgetEmptyEdit(currentRoot: MapNode, id: string) {
    const last = this.past[this.past.length - 1];
    if (!last) return;
    // Only when the topic was already empty when editing started (a new topic),
    // never when the user erased the text of an existing one.
    const before = find(JSON.parse(last.root), id)?.node;
    if (!before || before.text.trim() || before.children.length || before.note) return;
    const cur = JSON.stringify(currentRoot);
    this.past.pop(); // snapshot taken when editing started (it holds the empty topic)
    while (this.past.length && this.past[this.past.length - 1].root === cur) this.past.pop();
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
