import type { App } from "./app";
import { MapNode, find, moveTo, visibleOrder, cycleTask, addChild } from "./model";
import { layout, edgePath, bounds, Box, Size } from "./layout";
import { resolveColors, cssColor } from "./colors";

const SVGNS = "http://www.w3.org/2000/svg";

export class MapView {
  private world: HTMLElement;
  private nodesEl: HTMLElement;
  private edgesEl: SVGSVGElement;
  private els = new Map<string, HTMLElement>();
  private edgeEls = new Map<string, SVGPathElement>();
  boxes = new Map<string, Box>();
  /** Colour token (name or #hex) per visible topic. */
  colors = new Map<string, string>();
  cam = { x: 0, y: 0, s: 1 };
  private camSet = false;

  constructor(private app: App, private host: HTMLElement) {
    this.world = host.querySelector("#world")!;
    this.nodesEl = host.querySelector("#nodes")!;
    this.edgesEl = host.querySelector("#edges")!;
    this.wireMouse();
    new ResizeObserver(() => {
      if (!this.camSet && this.boxes.size) this.fit(true);
    }).observe(host);
  }

  // ------------------------------------------------------------ rendering
  render() {
    const top = this.app.top;
    const visible = visibleOrder(top);
    const keep = new Set(visible.map((n) => n.id));
    this.colors = resolveColors(top);
    for (const [id, el] of this.els) {
      if (!keep.has(id)) {
        el.remove();
        this.els.delete(id);
      }
    }
    const depthOf = new Map<string, number>();
    const rec = (n: MapNode, d: number) => {
      depthOf.set(n.id, d);
      if (!n.collapsed) n.children.forEach((c) => rec(c, d + 1));
    };
    rec(top, 0);
    for (const n of visible) {
      let el = this.els.get(n.id);
      if (!el) {
        el = this.createEl(n.id);
        this.els.set(n.id, el);
        this.nodesEl.append(el);
      }
      this.paint(el, n, depthOf.get(n.id)!);
    }
    this.relayout();
    this.renderSelection();
    const hint = this.host.querySelector<HTMLElement>("#empty-hint")!;
    hint.hidden = this.app.store.hasFolder();
    if (!hint.hidden) hint.innerHTML = `<p>Choose a folder for your maps.</p><p><kbd>⌘K</kbd> → “Choose maps folder”</p>`;
  }

  private createEl(id: string) {
    const el = document.createElement("div");
    el.className = "node";
    el.dataset.id = id;
    el.innerHTML = `<span class="box"></span><span class="txt"></span><span class="ndot" title="Has notes"></span><span class="badge"></span>`;
    return el;
  }

  private paint(el: HTMLElement, n: MapNode, depth: number) {
    const isTop = n === this.app.top;
    el.className = "node " + (isTop ? "root" : depth === 1 ? "d1" : "dn");
    const c = this.colors.get(n.id);
    if (c) el.style.setProperty("--c", cssColor(c));
    else el.style.removeProperty("--c");
    // A coloured central topic uses the colour as its fill.
    el.classList.toggle("custom", isTop && !!n.color);
    el.classList.toggle("todo", n.task === "todo");
    el.classList.toggle("done", n.task === "done");
    el.classList.toggle("has-note", !!n.note.trim());
    el.classList.toggle("folded", !!n.collapsed && n.children.length > 0);
    const badge = el.querySelector<HTMLElement>(".badge")!;
    badge.textContent = n.collapsed && n.children.length ? String(countDesc(n)) : "";
    const txt = el.querySelector<HTMLElement>(".txt")!;
    if (this.app.editing !== n.id && txt.textContent !== n.text) txt.textContent = n.text;
    el.classList.toggle("empty", !n.text);
  }

  updateNode(id: string) {
    const el = this.els.get(id);
    const l = find(this.app.root, id);
    if (!el || !l) return;
    const depth = l.depth - (this.app.focusId ? find(this.app.root, this.app.focusId)!.depth : 0);
    this.paint(el, l.node, depth);
    this.relayout();
    this.renderSelection();
  }

  relayout() {
    if (this.app.view !== "map") return;
    const sizes = new Map<string, Size>();
    for (const [id, el] of this.els) sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    this.boxes = layout(this.app.top, sizes, this.app.layout);
    for (const [id, el] of this.els) {
      const b = this.boxes.get(id);
      if (!b) continue;
      el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      el.classList.toggle("left", b.side === -1);
    }
    // Edges
    const seen = new Set<string>();
    for (const [id, b] of this.boxes) {
      if (!b.parent) continue;
      const p = this.boxes.get(b.parent);
      if (!p) continue;
      seen.add(id);
      let path = this.edgeEls.get(id);
      if (!path) {
        path = document.createElementNS(SVGNS, "path");
        this.edgesEl.append(path);
        this.edgeEls.set(id, path);
      }
      path.setAttribute("d", edgePath(p, b));
      path.setAttribute("class", "edge" + (b.depth === 1 ? " e1" : ""));
      path.style.stroke = cssColor(this.colors.get(id) ?? "gray");
    }
    for (const [id, path] of this.edgeEls) {
      if (!seen.has(id)) {
        path.remove();
        this.edgeEls.delete(id);
      }
    }
    if (!this.camSet && this.boxes.size) this.fit(true);
  }

  renderSelection() {
    for (const [id, el] of this.els) {
      el.classList.toggle("sel", id === this.app.sel);
      el.classList.toggle("editing", id === this.app.editing);
    }
  }

  // ------------------------------------------------------------ editing
  beginEdit(id: string, caret: "end" | "start" | "all" | { replace: string }) {
    if (!this.els.has(id)) this.render();
    const el = this.els.get(id);
    if (!el) return;
    const txt = el.querySelector<HTMLElement>(".txt")!;
    if (txt.isContentEditable && (txt as any)._cleanup) {
      if (document.activeElement !== txt) txt.focus({ preventScroll: true });
      this.relayout();
      this.ensureVisible(id);
      return;
    }
    const n = this.app.node(id)!;
    txt.textContent = n.text;
    try {
      txt.contentEditable = "plaintext-only";
    } catch {
      txt.contentEditable = "true";
    }
    if (txt.contentEditable !== "plaintext-only") txt.contentEditable = "true";
    txt.spellcheck = true;
    el.classList.add("editing");
    el.classList.toggle("empty", !n.text);
    txt.focus({ preventScroll: true });
    placeCaret(txt, typeof caret === "object" ? "end" : caret);
    this.relayout();
    this.ensureVisible(id);

    const onInput = () => {
      const v = txt.innerText.replace(/\n$/, "");
      this.app.setText(id, v);
      el.classList.toggle("empty", !v);
      this.relayout();
      this.ensureVisible(id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const { atStart, atEnd } = caretEdges(txt);
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) return; // line break
      this.app.editKey(e, id, atStart, atEnd);
    };
    const onBlur = () => {
      // Defer: focus might be moving to another part of the app that handles it.
      setTimeout(() => {
        if (!txt.isConnected) return;
        if (this.app.editing === id && document.activeElement !== txt) this.app.stopEdit();
      }, 0);
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData("text/plain") ?? "";
      if (t.includes("\n")) {
        // Multi-line paste while typing: first line goes in this topic, the rest become siblings/children.
        e.preventDefault();
        this.app.stopEdit({ keepEmpty: true });
        this.app.pasteText(t);
      }
    };
    txt.addEventListener("input", onInput);
    txt.addEventListener("keydown", onKey);
    txt.addEventListener("blur", onBlur);
    txt.addEventListener("paste", onPaste);
    (txt as any)._cleanup = () => {
      txt.removeEventListener("input", onInput);
      txt.removeEventListener("keydown", onKey);
      txt.removeEventListener("blur", onBlur);
      txt.removeEventListener("paste", onPaste);
    };
  }

  endEdit(id: string) {
    const el = this.els.get(id);
    if (!el) return;
    const txt = el.querySelector<HTMLElement>(".txt")!;
    (txt as any)._cleanup?.();
    (txt as any)._cleanup = null;
    txt.removeAttribute("contenteditable");
    el.classList.remove("editing");
    const n = this.app.node(id);
    if (n) txt.textContent = n.text;
  }

  // ------------------------------------------------------------ camera
  private applyCam(animate = false) {
    this.world.classList.toggle("anim", animate);
    this.world.style.transform = `translate(${this.cam.x}px, ${this.cam.y}px) scale(${this.cam.s})`;
    this.host.style.setProperty("--zoom", String(this.cam.s));
    if (animate) {
      clearTimeout((this as any)._animT);
      (this as any)._animT = setTimeout(() => this.world.classList.remove("anim"), 200);
    }
  }

  fit(instant = false) {
    if (this.app.view !== "map") return;
    this.relayoutIfEmpty();
    const bb = bounds(this.boxes.values());
    const vw = this.host.clientWidth,
      vh = this.host.clientHeight;
    if (!vw || !vh) return;
    const w = bb.maxX - bb.minX + 120,
      h = bb.maxY - bb.minY + 120;
    const s = Math.max(0.3, Math.min(1.1, vw / w, vh / h));
    this.cam = { s, x: vw / 2 - ((bb.minX + bb.maxX) / 2) * s, y: vh / 2 - ((bb.minY + bb.maxY) / 2) * s };
    this.camSet = true;
    this.applyCam(!instant);
  }

  private relayoutIfEmpty() {
    if (!this.boxes.size) this.relayout();
  }

  center(id: string) {
    const b = this.boxes.get(id);
    if (!b) return;
    const vw = this.host.clientWidth,
      vh = this.host.clientHeight;
    this.cam.x = vw / 2 - (b.x + b.w / 2) * this.cam.s;
    this.cam.y = vh / 2 - (b.y + b.h / 2) * this.cam.s;
    this.applyCam(true);
  }

  ensureVisible(id: string) {
    if (this.app.view !== "map") return;
    const b = this.boxes.get(id);
    if (!b) return;
    const m = 48;
    const vw = this.host.clientWidth,
      vh = this.host.clientHeight;
    const s = this.cam.s;
    const x1 = this.cam.x + b.x * s,
      y1 = this.cam.y + b.y * s,
      x2 = x1 + b.w * s,
      y2 = y1 + b.h * s;
    let dx = 0,
      dy = 0;
    if (x2 > vw - m) dx = vw - m - x2;
    if (x1 + dx < m) dx = m - x1;
    if (y2 > vh - m) dy = vh - m - y2;
    if (y1 + dy < m) dy = m - y1;
    if (dx || dy) {
      this.cam.x += dx;
      this.cam.y += dy;
      this.applyCam(true);
    }
  }

  zoomBy(f: number, cx?: number, cy?: number) {
    const vw = this.host.clientWidth,
      vh = this.host.clientHeight;
    const px = cx ?? vw / 2,
      py = cy ?? vh / 2;
    const s = Math.max(0.15, Math.min(3, this.cam.s * f));
    const k = s / this.cam.s;
    this.cam.x = px - (px - this.cam.x) * k;
    this.cam.y = py - (py - this.cam.y) * k;
    this.cam.s = s;
    this.applyCam(cx === undefined);
  }

  // ------------------------------------------------------------ navigation
  spatialNeighbor(id: string, dir: "left" | "right" | "up" | "down"): string | "expand" | null {
    const b = this.boxes.get(id);
    if (!b) return null;
    const n = this.app.node(id)!;
    const cx = b.x + b.w / 2,
      cy = b.y + b.h / 2;
    const horizontal = dir === "left" || dir === "right";
    const sign = dir === "right" || dir === "down" ? 1 : -1;
    const isRoot = !b.parent;
    if (horizontal) {
      const outward = isRoot || sign === b.side;
      if (!outward && b.parent) return b.parent;
      if (outward) {
        if (n.collapsed && n.children.length) return "expand";
        const kids = n.children.map((c) => this.boxes.get(c.id)).filter((k): k is Box => !!k && (!isRoot || k.side === sign));
        if (kids.length) {
          let best = kids[0];
          for (const k of kids) if (Math.abs(k.y + k.h / 2 - cy) < Math.abs(best.y + best.h / 2 - cy)) best = k;
          return idOf(this.boxes, best);
        }
        return null;
      }
    }
    // Up/down: nearest sibling on the same side first, so arrows walk a list predictably.
    if (!horizontal && b.parent) {
      const parent = this.app.node(b.parent);
      const sibs = (parent?.children ?? [])
        .map((s) => [s.id, this.boxes.get(s.id)] as const)
        .filter(([sid, sb]) => sid !== id && sb && sb.side === b.side && (sb.y + sb.h / 2 - cy) * sign > 2)
        .sort((x, y) => Math.abs(x[1]!.y - b.y) - Math.abs(y[1]!.y - b.y));
      if (sibs.length) return sibs[0][0];
    }
    let bestId: string | null = null;
    let bestScore = Infinity;
    for (const [oid, o] of this.boxes) {
      if (oid === id) continue;
      const ox = o.x + o.w / 2,
        oy = o.y + o.h / 2;
      if (horizontal) {
        const d = (ox - cx) * sign;
        if (d <= 4) continue;
        const score = d + 3 * Math.abs(oy - cy);
        if (score < bestScore) (bestScore = score), (bestId = oid);
      } else {
        const d = (oy - cy) * sign;
        if (d <= 2 || o.depth !== b.depth || o.side !== b.side) continue; // cousins only
        const gapX = Math.max(0, o.x - (b.x + b.w), b.x - (o.x + o.w));
        const score = d + 3 * gapX + 30 * Math.abs(o.depth - b.depth) + (o.side !== b.side ? 400 : 0);
        if (score < bestScore) (bestScore = score), (bestId = oid);
      }
    }
    return bestId;
  }

  // ------------------------------------------------------------ mouse
  private wireMouse() {
    const host = this.host;
    let mode: "none" | "pan" | "maybe-drag" | "drag" = "none";
    let sx = 0,
      sy = 0,
      camX = 0,
      camY = 0;
    let dragId: string | null = null;
    let ghost: HTMLElement | null = null;
    let target: { el: HTMLElement; where: "child" | "before" | "after" } | null = null;

    const clearTarget = () => {
      target?.el.classList.remove("drop-child", "drop-before", "drop-after");
      target = null;
    };

    host.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>(".node");
      sx = e.clientX;
      sy = e.clientY;
      if (nodeEl) {
        if (nodeEl.classList.contains("editing")) return; // let text selection work
        e.preventDefault();
        dragId = nodeEl.dataset.id!;
        mode = "maybe-drag";
      } else {
        e.preventDefault();
        mode = "pan";
        camX = this.cam.x;
        camY = this.cam.y;
        host.classList.add("panning");
        if (this.app.editing) this.app.stopEdit();
        this.app.focusSink();
      }
    });

    window.addEventListener("mousemove", (e) => {
      if (mode === "pan") {
        this.cam.x = camX + e.clientX - sx;
        this.cam.y = camY + e.clientY - sy;
        this.applyCam();
      } else if (mode === "maybe-drag" && Math.hypot(e.clientX - sx, e.clientY - sy) > 6 && dragId !== this.app.top.id) {
        mode = "drag";
        const src = this.els.get(dragId!)!;
        ghost = src.cloneNode(true) as HTMLElement;
        ghost.classList.add("ghost");
        ghost.style.transform = "";
        document.body.append(ghost);
        src.classList.add("dragging");
      }
      if (mode === "drag" && ghost) {
        ghost.style.left = e.clientX + 8 + "px";
        ghost.style.top = e.clientY + 8 + "px";
        clearTarget();
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".node");
        if (under && under.dataset.id !== dragId && !under.classList.contains("ghost")) {
          const r = under.getBoundingClientRect();
          const f = (e.clientY - r.top) / r.height;
          const isTop = under.dataset.id === this.app.top.id;
          const where = isTop ? "child" : f < 0.28 ? "before" : f > 0.72 ? "after" : "child";
          under.classList.add("drop-" + where);
          target = { el: under, where };
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (mode === "pan") {
        host.classList.remove("panning");
      } else if (mode === "maybe-drag" && dragId) {
        const t = e.target as HTMLElement;
        const n = this.app.node(dragId);
        if (n && t.classList.contains("box")) this.app.mutate(() => void cycleTaskDone(n));
        else if (n && t.classList.contains("badge")) this.app.mutate(() => void (n.collapsed = false));
        else this.app.select(dragId, { scroll: false });
        this.app.focusSink();
      } else if (mode === "drag" && dragId) {
        ghost?.remove();
        ghost = null;
        this.els.get(dragId)?.classList.remove("dragging");
        if (target) {
          const tid = target.el.dataset.id!;
          const where = target.where;
          const id = dragId;
          this.app.mutate(() => (moveTo(this.app.root, id, tid, where) ? id : null));
        }
        clearTarget();
        this.app.focusSink();
      }
      mode = "none";
      dragId = null;
    });

    host.addEventListener("dblclick", (e) => {
      const nodeEl = (e.target as HTMLElement).closest<HTMLElement>(".node");
      if (nodeEl && !nodeEl.classList.contains("editing")) this.app.startEdit(nodeEl.dataset.id!, "end");
      else if (!nodeEl && this.app.sel) {
        // Double-click on empty canvas adds a child to the selected topic.
        const sel = this.app.sel;
        this.app.mutate(() => addChild(this.app.root, sel), { edit: true });
      }
    });

    host.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const r = host.getBoundingClientRect();
          this.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
        } else {
          this.cam.x -= e.deltaX;
          this.cam.y -= e.deltaY;
          this.applyCam();
        }
      },
      { passive: false },
    );
  }
}

function cycleTaskDone(n: MapNode) {
  // Clicking the box toggles done/todo; it never removes the box.
  if (n.task === "todo") n.task = "done";
  else if (n.task === "done") n.task = "todo";
  else cycleTask(n);
}

function countDesc(n: MapNode): number {
  let c = 0;
  const rec = (x: MapNode) => x.children.forEach((k) => (c++, rec(k)));
  rec(n);
  return c;
}

function idOf(boxes: Map<string, Box>, b: Box): string | null {
  for (const [id, x] of boxes) if (x === b) return id;
  return null;
}

export function placeCaret(el: HTMLElement, where: "start" | "end" | "all") {
  const r = document.createRange();
  r.selectNodeContents(el);
  if (where === "start") r.collapse(true);
  else if (where === "end") r.collapse(false);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

export function caretEdges(el: HTMLElement): { atStart: boolean; atEnd: boolean } {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return { atStart: true, atEnd: true };
  const r = s.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  const post = document.createRange();
  post.selectNodeContents(el);
  post.setStart(r.endContainer, r.endOffset);
  return { atStart: pre.toString().length === 0 && r.collapsed, atEnd: post.toString().length === 0 && r.collapsed };
}
