// Gantt view (⌘3): every topic with dates as a bar on a timeline.
// Drag a bar to move it, its ends to change start/due, the knob under it to set
// progress. Tasks that come after it move along. Click a row to select the topic
// (the style panel edits its details); Shift-click to pick several, then
// "Dependencies" chains them in the order picked.

import type { App } from "./app";
import { MapNode, find, findByAnchor, walk } from "./model";
import { addDays, dayStr, parseDay, progressOf, reschedule, rollup, scheduled, shortDate, span, todayStr } from "./plan";
import { resolveColors, cssColor, hexColor } from "./colors";
import { icon } from "./ui-icons";
import { showMenu } from "./menu";

type Zoom = "day" | "week" | "month";
const PPD: Record<Zoom, number> = { day: 34, week: 13, month: 4.2 };
const ROW = 36;
const HEAD = 52;
const LEFT = 380;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

interface Row {
  node: MapNode;
  depth: number;
  start: number; // day numbers
  due: number;
  own: boolean; // has its own dates (draggable); otherwise a group bar
  hasKids: boolean;
  progress?: number;
  color: string; // css colour
  hex: string; // export colour
}

interface Geo {
  rows: Row[];
  min: number;
  max: number;
  ppd: number;
  width: number;
}

export class GanttView {
  private zoom: Zoom = (localStorage.getItem("lm:gantt-zoom") as Zoom) || "day";
  private folded = new Set<string>();
  private geo: Geo | null = null;
  private scrolledTo = "";

  constructor(
    private app: App,
    private host: HTMLElement,
  ) {
    host.innerHTML = `
      <div class="g-top">
        <div class="seg g-zoom">${(["day", "week", "month"] as Zoom[]).map((z) => `<button data-z="${z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join("")}</div>
        <button class="g-btn" id="g-today">${icon("target")}<span>Today</span></button>
        <button class="g-btn" id="g-chain" title="Shift-click tasks in order, then chain them">${icon("link")}<span>Dependencies</span></button>
        <button class="g-btn" id="g-add" title="Give the selected topic dates (⌘⇧K)">${icon("calendar")}<span>Add task</span></button>
        <span class="spacer"></span>
        <button class="g-btn" id="g-export">${icon("export")}<span>Export</span></button>
        <button class="g-btn" id="g-print">${icon("printer")}<span>Print</span></button>
      </div>
      <div class="g-scroll"><div class="g-inner"></div></div>
      <div class="g-empty" hidden>
        <p><b>No tasks with dates yet.</b></p>
        <p>Select a topic and press <kbd>⌘⇧K</kbd> (or <i>Add task details</i> in the style panel) to give it a start and due date.</p>
      </div>`;
    host.querySelector(".g-zoom")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-z]");
      if (!b) return;
      this.zoom = b.dataset.z as Zoom;
      localStorage.setItem("lm:gantt-zoom", this.zoom);
      this.render();
      this.scrollToDay(parseDay(todayStr()));
    });
    host.querySelector("#g-today")!.addEventListener("click", () => this.scrollToDay(parseDay(todayStr()), true));
    host.querySelector("#g-chain")!.addEventListener("click", () => this.app.tasks.chain([this.app.sel!, ...this.app.extra].filter(Boolean)));
    host.querySelector("#g-add")!.addEventListener("click", () => this.app.tasks.addPlan());
    host.querySelector("#g-export")!.addEventListener("click", (e) =>
      showMenu(e.currentTarget as HTMLElement, [
        { label: "PNG image", icon: icon("image"), run: () => this.export("png") },
        { label: "JPEG image", icon: icon("image"), run: () => this.export("jpg") },
        { label: "PDF", icon: icon("note"), run: () => this.export("pdf") },
        { label: "Excel (CSV)", icon: icon("list"), run: () => this.export("csv") },
        { label: "Calendar (.ics)", icon: icon("calendar"), run: () => this.export("ics") },
      ], () => this.app.focusSink(), "right"),
    );
    host.querySelector("#g-print")!.addEventListener("click", () => this.print());
    this.wireMouse();
  }

  // ------------------------------------------------------------ model
  private build(): Geo | null {
    const colors = resolveColors(this.app.root);
    const rows: Row[] = [];
    const hidden = new Set<string>();
    for (const { node, depth } of scheduled(this.app.top)) {
      const l = find(this.app.root, node.id);
      if (l?.parent && (hidden.has(l.parent.id) || this.folded.has(l.parent.id))) {
        hidden.add(node.id);
        continue;
      }
      const own = span(node.plan);
      const r = own.start && own.due ? { start: own.start, due: own.due } : rollup(node);
      if (!r) continue;
      const c = colors.get(node.id) ?? "gray";
      rows.push({
        node,
        depth,
        start: parseDay(r.start),
        due: parseDay(r.due),
        own: !!(own.start && own.due),
        hasKids: node.children.some((k) => !!rollup(k)),
        progress: progressOf(node),
        color: cssColor(c),
        hex: hexColor(c),
      });
    }
    if (!rows.length) return null;
    let min = Math.min(...rows.map((r) => r.start)),
      max = Math.max(...rows.map((r) => r.due));
    const today = parseDay(todayStr());
    if (today >= min - 45 && today <= max + 45) {
      min = Math.min(min, today);
      max = Math.max(max, today);
    }
    const pad = this.zoom === "day" ? 3 : this.zoom === "week" ? 7 : 20;
    min -= pad;
    max += pad * 3;
    // Start on a Monday (or the 1st, for months) so the header lines up.
    if (this.zoom === "month") min = parseDay(dayStr(min).slice(0, 8) + "01");
    else min -= (new Date(min * 86400000).getUTCDay() + 6) % 7;
    const ppd = PPD[this.zoom];
    const viewW = Math.max(0, this.host.clientWidth - LEFT);
    max = Math.max(max, min + Math.ceil(viewW / ppd));
    return { rows, min, max, ppd, width: (max - min + 1) * ppd };
  }

  // ------------------------------------------------------------ render
  render() {
    if (this.app.view !== "gantt") return;
    this.host.querySelectorAll<HTMLButtonElement>(".g-zoom button").forEach((b) => b.classList.toggle("on", b.dataset.z === this.zoom));
    const g = (this.geo = this.build());
    const inner = this.host.querySelector<HTMLElement>(".g-inner")!;
    (this.host.querySelector(".g-empty") as HTMLElement).hidden = !!g;
    (this.host.querySelector(".g-scroll") as HTMLElement).hidden = !g;
    if (!g) return;
    const H = g.rows.length * ROW;
    inner.style.width = LEFT + g.width + "px";
    inner.innerHTML = `
      <div class="g-head">
        <div class="g-lhead"><span>Task</span><span>Start</span><span>Days</span><span>%</span></div>
        <svg class="g-thead" width="${g.width}" height="${HEAD}">${this.headSVG(g)}</svg>
      </div>
      <div class="g-body">
        <div class="g-left">${g.rows.map((r, i) => this.rowHTML(r, i)).join("")}</div>
        <svg class="g-svg" width="${g.width}" height="${H}">
          <defs><marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="var(--muted)"/></marker></defs>
          ${this.gridSVG(g, H)}
          <g class="g-deps">${this.depsSVG(g)}</g>
          <g class="g-bars">${g.rows.map((r, i) => this.barSVG(g, r, i)).join("")}</g>
          ${this.todaySVG(g, H)}
        </svg>
      </div>`;
    this.renderSelection();
    const key = this.app.fileName + "|" + this.zoom;
    if (this.scrolledTo !== key) {
      this.scrolledTo = key;
      requestAnimationFrame(() => this.scrollToDay(Math.min(...g.rows.map((r) => r.start)) - 2));
    }
  }

  renderSelection() {
    if (!this.geo) return;
    const sel = this.app.sel;
    this.host.querySelectorAll<HTMLElement>("[data-row]").forEach((el) => {
      const id = el.dataset.row!;
      el.classList.toggle("sel", id === sel);
      el.classList.toggle("msel", this.app.extra.has(id));
    });
    if (sel) {
      const el = this.host.querySelector<HTMLElement>(`.g-left [data-row="${CSS.escape(sel)}"]`);
      el?.scrollIntoView({ block: "nearest" });
    }
  }

  private x(g: Geo, day: number) {
    return (day - g.min) * g.ppd;
  }

  private headSVG(g: Geo): string {
    let s = "";
    const top = 24;
    // Upper row: months (or years when zoomed out).
    let d = g.min;
    while (d <= g.max) {
      const ds = dayStr(d);
      const [y, m] = ds.split("-").map(Number);
      const next = this.zoom === "month" ? parseDay(`${y + 1}-01-01`) : parseDay(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`);
      const x1 = this.x(g, d),
        x2 = this.x(g, Math.min(next, g.max + 1));
      const label = this.zoom === "month" ? String(y) : `${MONTHS[m - 1]} ${y}`;
      s += `<line x1="${x1}" y1="0" x2="${x1}" y2="${HEAD}" class="g-hline"/><text x="${x1 + 8}" y="16" class="g-htext">${label}</text>`;
      if (x2 - x1 < 60) s = s.replace(/<text[^>]*>[^<]*<\/text>$/, "");
      d = next;
    }
    // Lower row: days, weeks or months.
    for (let day = g.min; day <= g.max; day++) {
      const ds = dayStr(day);
      const dt = new Date(day * 86400000);
      const x = this.x(g, day);
      if (this.zoom === "day") {
        const we = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
        s += `<text x="${x + g.ppd / 2}" y="${top + 18}" class="g-dtext${we ? " we" : ""}" text-anchor="middle">${dt.getUTCDate()}</text>`;
      } else if (this.zoom === "week" && dt.getUTCDay() === 1) {
        s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${HEAD}" class="g-hline2"/><text x="${x + 4}" y="${top + 18}" class="g-dtext">${shortDate(ds)}</text>`;
      } else if (this.zoom === "month" && ds.endsWith("-01")) {
        s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${HEAD}" class="g-hline2"/><text x="${x + 4}" y="${top + 18}" class="g-dtext">${MONTHS[dt.getUTCMonth()].slice(0, 3)}</text>`;
      }
    }
    return s + `<line x1="0" y1="${HEAD - 0.5}" x2="${g.width}" y2="${HEAD - 0.5}" class="g-hline"/>`;
  }

  private gridSVG(g: Geo, H: number): string {
    let s = "";
    g.rows.forEach((r, i) => (s += `<rect x="0" y="${i * ROW}" width="${g.width}" height="${ROW}" class="g-rowbg" data-row="${r.node.id}"/>`));
    for (let day = g.min; day <= g.max; day++) {
      const dt = new Date(day * 86400000);
      const x = this.x(g, day);
      if (this.zoom === "day") {
        if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) s += `<rect x="${x}" y="0" width="${g.ppd}" height="${H}" class="g-weekend"/>`;
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="g-vline"/>`;
      } else if ((this.zoom === "week" && dt.getUTCDay() === 1) || (this.zoom === "month" && dt.getUTCDate() === 1))
        s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="g-vline"/>`;
    }
    return s;
  }

  private todaySVG(g: Geo, H: number): string {
    const t = parseDay(todayStr());
    if (t < g.min || t > g.max) return "";
    const x = this.x(g, t) + g.ppd / 2;
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="g-today"/>`;
  }

  private barSVG(g: Geo, r: Row, i: number): string {
    const x = this.x(g, r.start),
      w = Math.max(g.ppd * 0.6, (r.due - r.start + 1) * g.ppd);
    const y = i * ROW;
    const id = r.node.id;
    const p = r.progress ?? 0;
    const name = esc(oneLine(r.node.text));
    if (!r.own) {
      // Group: thin bracket bar spanning its sub-tasks.
      return `<g class="g-group" data-id="${id}"><path d="M${x},${y + 12} h${w} v12 l-6,-6 H${x + 6} l-6,6 z" fill="${r.color}" opacity="0.85"/><rect x="${x}" y="${y + 12}" width="${(w * p) / 100}" height="6" fill="#000" opacity="0.18"/><text x="${x + w + 8}" y="${y + 22}" class="g-blabel">${name}</text></g>`;
    }
    const knob = x + (w * p) / 100;
    const inside = w > name.length * 6.5 + 40;
    return `<g class="g-bar-g" data-id="${id}">
      <rect class="g-bar" x="${x}" y="${y + 7}" width="${w}" height="${ROW - 14}" rx="6" fill="${r.color}" fill-opacity="0.35" stroke="${r.color}"/>
      <rect class="g-done" x="${x}" y="${y + 7}" width="${(w * p) / 100}" height="${ROW - 14}" rx="6" fill="${r.color}" pointer-events="none"/>
      ${inside ? `<text x="${x + 10}" y="${y + ROW / 2 + 4}" class="g-btext" pointer-events="none">${name}</text>` : `<text x="${x + w + 8}" y="${y + ROW / 2 + 4}" class="g-blabel" pointer-events="none">${name}</text>`}
      <rect class="g-h g-hl" x="${x - 3}" y="${y + 7}" width="8" height="${ROW - 14}"/>
      <rect class="g-h g-hr" x="${x + w - 5}" y="${y + 7}" width="8" height="${ROW - 14}"/>
      <path class="g-knob" d="M${knob},${y + ROW - 9} l5,7 h-10 z" fill="${r.color}"/>
    </g>`;
  }

  private depsSVG(g: Geo): string {
    const idx = new Map(g.rows.map((r, i) => [r.node.id, i]));
    let s = "";
    g.rows.forEach((r, i) => {
      for (const a of r.node.plan?.after ?? []) {
        const p = findByAnchor(this.app.root, a);
        const j = p ? idx.get(p.id) : undefined;
        if (j === undefined) continue;
        const pr = g.rows[j];
        const x1 = this.x(g, pr.due + 1),
          y1 = j * ROW + ROW / 2,
          x2 = this.x(g, r.start),
          y2 = i * ROW + ROW / 2;
        const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
        const d =
          x2 - 8 >= x1 + 8
            ? `M${x1},${y1} H${mid} V${y2} H${x2}`
            : `M${x1},${y1} h8 V${(y1 + y2) / 2 + (y2 > y1 ? -ROW / 2 + 4 : ROW / 2 - 4)} H${x2 - 10} V${y2} H${x2}`;
        s += `<path d="${d}" class="g-dep" marker-end="url(#g-arrow)"/>`;
      }
    });
    return s;
  }

  private rowHTML(r: Row, i: number): string {
    const id = r.node.id;
    const fold = r.hasKids ? `<button class="g-fold" data-fold="${id}">${this.folded.has(id) ? "▸" : "▾"}</button>` : `<span class="g-fold"></span>`;
    const days = r.due - r.start + 1;
    const pri = r.node.plan?.priority ? `<b class="g-pri p${r.node.plan.priority}">P${r.node.plan.priority}</b>` : "";
    return `<div class="g-row${r.own ? "" : " group"}" data-row="${id}" style="top:${i * ROW}px">
      <span class="g-name" style="padding-left:${6 + r.depth * 14}px">${fold}${pri}<span class="g-nt" title="${esc(r.node.text)}">${esc(oneLine(r.node.text)) || "Untitled"}</span></span>
      ${r.own ? `<input type="date" class="g-start" value="${dayStr(r.start)}" />` : `<span class="g-start">${shortDate(dayStr(r.start))}</span>`}
      ${r.own ? `<input type="number" class="g-days" min="1" value="${days}" />` : `<span class="g-days">${days}</span>`}
      <span class="g-pct">${r.progress === undefined ? "" : r.progress + "%"}</span>
    </div>`;
  }

  private scrollToDay(day: number, smooth = false) {
    const g = this.geo;
    if (!g) return;
    const sc = this.host.querySelector<HTMLElement>(".g-scroll")!;
    sc.scrollTo({ left: Math.max(0, this.x(g, day) - 40), behavior: smooth ? "smooth" : "auto" });
  }

  // ------------------------------------------------------------ editing
  private setDates(n: MapNode, start: number, due: number) {
    this.app.mutate(() => {
      n.plan = { ...(n.plan ?? {}), start: dayStr(start), due: dayStr(Math.max(start, due)) };
      reschedule(this.app.root);
    });
  }

  private wireMouse() {
    const host = this.host;
    host.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const fold = t.closest<HTMLElement>("[data-fold]");
      if (fold) {
        const id = fold.dataset.fold!;
        if (this.folded.has(id)) this.folded.delete(id);
        else this.folded.add(id);
        this.render();
        return;
      }
      if (t.closest("input")) return;
      const row = t.closest<HTMLElement>(".g-left [data-row]");
      if (row) this.app.select(row.dataset.row!, { scroll: false, add: e.shiftKey });
    });
    host.addEventListener("dblclick", async (e) => {
      const nt = (e.target as HTMLElement).closest<HTMLElement>(".g-name");
      const row = nt?.closest<HTMLElement>("[data-row]");
      if (!row) return;
      const n = find(this.app.root, row.dataset.row!)?.node;
      if (!n) return;
      const v = await this.app.palette.prompt("Rename task", n.text);
      if (v !== null && v.trim()) this.app.mutate(() => void (n.text = v.trim()));
      this.app.focusSink();
    });
    host.addEventListener("change", (e) => {
      const inp = e.target as HTMLInputElement;
      const row = inp.closest<HTMLElement>("[data-row]");
      const n = row && find(this.app.root, row.dataset.row!)?.node;
      if (!n) return;
      const s = span(n.plan);
      if (inp.classList.contains("g-start") && inp.value) {
        const st = parseDay(inp.value);
        this.setDates(n, st, st + (s.days ?? 1) - 1);
      }
      if (inp.classList.contains("g-days")) {
        const d = Math.max(1, Math.round(Number(inp.value) || 1));
        const st = parseDay(s.start ?? todayStr());
        this.setDates(n, st, st + d - 1);
      }
    });
    host.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT" && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        (e.target as HTMLInputElement).blur();
        this.app.focusSink();
      }
    });

    // Bars: drag to move / resize / set progress.
    let drag: { id: string; mode: "move" | "l" | "r" | "prog" | "click"; x0: number; start: number; due: number; moved: boolean; g: SVGGElement; shift: boolean } | null = null;
    host.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      const t = e.target as Element;
      const gEl = t.closest<SVGGElement>("g.g-bar-g, g.g-group");
      const rowBg = t.closest<SVGRectElement>("rect.g-rowbg");
      if (!gEl) {
        if (rowBg) this.app.select(rowBg.dataset.row!, { scroll: false, add: e.shiftKey });
        return;
      }
      e.preventDefault();
      const id = gEl.dataset.id!;
      const n = find(this.app.root, id)?.node;
      if (!n || !this.geo) return;
      const r = this.geo.rows.find((x) => x.node.id === id)!;
      const mode = !r.own ? "click" : t.classList.contains("g-hl") ? "l" : t.classList.contains("g-hr") ? "r" : t.classList.contains("g-knob") ? "prog" : "move";
      drag = { id, mode, x0: e.clientX, start: r.start, due: r.due, moved: false, g: gEl, shift: e.shiftKey };
      document.body.classList.add("g-dragging");
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag || !this.geo) return;
      const dx = e.clientX - drag.x0;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (!drag.moved || drag.mode === "click") return;
      const g = this.geo;
      const dd = Math.round(dx / g.ppd);
      let s = drag.start,
        d = drag.due;
      if (drag.mode === "move") (s += dd), (d += dd);
      if (drag.mode === "l") s = Math.min(d, s + dd);
      if (drag.mode === "r") d = Math.max(s, d + dd);
      const x = this.x(g, s),
        w = (d - s + 1) * g.ppd;
      if (drag.mode === "prog") {
        const p = Math.max(0, Math.min(100, Math.round(((e.clientX - drag.g.querySelector(".g-bar")!.getBoundingClientRect().left) / ((drag.due - drag.start + 1) * g.ppd)) * 20) * 5));
        const bar = drag.g.querySelector<SVGRectElement>(".g-bar")!;
        const bx = Number(bar.getAttribute("x")),
          bw = Number(bar.getAttribute("width"));
        drag.g.querySelector(".g-done")!.setAttribute("width", String((bw * p) / 100));
        const kn = drag.g.querySelector(".g-knob")!;
        kn.setAttribute("d", kn.getAttribute("d")!.replace(/^M[\d.-]+,/, `M${bx + (bw * p) / 100},`));
        drag.g.dataset.p = String(p);
        this.tip(e, `${p}%`);
        return;
      }
      drag.g.setAttribute("transform", "");
      const bar = drag.g.querySelector<SVGRectElement>(".g-bar")!;
      bar.setAttribute("x", String(x));
      bar.setAttribute("width", String(w));
      drag.g.querySelectorAll<SVGElement>(".g-done, .g-knob, text, .g-h").forEach((el) => el.setAttribute("opacity", "0"));
      drag.g.dataset.s = String(s);
      drag.g.dataset.d = String(d);
      this.tip(e, `${shortDate(dayStr(s))} – ${shortDate(dayStr(d))} · ${d - s + 1} days`);
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      const dr = drag;
      drag = null;
      document.body.classList.remove("g-dragging");
      this.tip(null);
      const n = find(this.app.root, dr.id)?.node;
      if (!n) return;
      if (!dr.moved || dr.mode === "click") {
        this.app.select(dr.id, { scroll: false, add: dr.shift });
        return;
      }
      if (dr.mode === "prog") {
        const p = Number(dr.g.dataset.p ?? n.plan?.progress ?? 0);
        this.app.mutate(() => void (n.plan = { ...(n.plan ?? {}), progress: p }));
        return;
      }
      const s = Number(dr.g.dataset.s ?? dr.start),
        d = Number(dr.g.dataset.d ?? dr.due);
      if (s === dr.start && d === dr.due) return this.render();
      this.setDates(n, s, d);
      if (this.app.sel !== dr.id) this.app.select(dr.id, { scroll: false });
    });
  }

  private tipEl: HTMLElement | null = null;
  private tip(e: MouseEvent | null, text?: string) {
    if (!e) {
      this.tipEl?.remove();
      this.tipEl = null;
      return;
    }
    if (!this.tipEl) {
      this.tipEl = document.createElement("div");
      this.tipEl.className = "g-tip";
      document.body.append(this.tipEl);
    }
    this.tipEl.textContent = text ?? "";
    this.tipEl.style.left = e.clientX + 12 + "px";
    this.tipEl.style.top = e.clientY - 30 + "px";
  }

  // ------------------------------------------------------------ export
  /** The whole chart (table + timeline) as one SVG, for PNG / JPEG / PDF. */
  exportSVG(): string | null {
    const g = this.build();
    if (!g) return null;
    const H = g.rows.length * ROW;
    const W = LEFT + g.width;
    const text = "#1f2328",
      muted = "#6b7280",
      line = "#e5e7eb";
    let body = "";
    // Left table
    body += `<rect x="0" y="0" width="${W}" height="${HEAD + H}" fill="#ffffff"/>`;
    body += `<g font-size="12" fill="${muted}" font-weight="600"><text x="12" y="${HEAD - 18}">Task</text><text x="${LEFT - 160}" y="${HEAD - 18}">Start</text><text x="${LEFT - 74}" y="${HEAD - 18}">Days</text><text x="${LEFT - 34}" y="${HEAD - 18}">%</text></g>`;
    g.rows.forEach((r, i) => {
      const y = HEAD + i * ROW;
      body += `<line x1="0" y1="${y + ROW}" x2="${W}" y2="${y + ROW}" stroke="${line}"/>`;
      body += `<text x="${12 + r.depth * 14}" y="${y + ROW / 2 + 4}" font-size="13" fill="${text}" ${r.own ? "" : 'font-weight="600"'}>${esc(clip(oneLine(r.node.text), 32 - r.depth * 2))}</text>`;
      body += `<text x="${LEFT - 160}" y="${y + ROW / 2 + 4}" font-size="12" fill="${muted}">${shortDate(dayStr(r.start), true)}</text>`;
      body += `<text x="${LEFT - 74}" y="${y + ROW / 2 + 4}" font-size="12" fill="${muted}">${r.due - r.start + 1}</text>`;
      body += `<text x="${LEFT - 34}" y="${y + ROW / 2 + 4}" font-size="12" fill="${muted}">${r.progress ?? ""}</text>`;
    });
    body += `<line x1="${LEFT}" y1="0" x2="${LEFT}" y2="${HEAD + H}" stroke="${line}"/>`;
    // Timeline (re-use the on-screen pieces, with export colours)
    const fix = (s: string) => {
      let out = s;
      g.rows.forEach((r) => (out = out.split(r.color).join(r.hex)));
      return out.replace(/var\(--muted\)/g, muted);
    };
    const tl = `<g transform="translate(${LEFT},0)" font-size="12">${fix(this.headSVG(g))}<g transform="translate(0,${HEAD})">${fix(this.gridSVG(g, H))}${fix(this.depsSVG(g))}${fix(g.rows.map((r, i) => this.barSVG(g, r, i)).join(""))}${this.todaySVG(g, H)}</g></g>`;
    const style = `<style>
      .g-hline{stroke:${line}} .g-hline2{stroke:${line}} .g-vline{stroke:${line};stroke-opacity:.6} .g-weekend{fill:#f3f4f6}
      .g-htext{fill:${text};font-weight:600;font-size:12px} .g-dtext{fill:${muted};font-size:11px} .g-dtext.we{fill:#9ca3af}
      .g-rowbg{fill:none} .g-today{stroke:#e5484d;stroke-width:1.5} .g-dep{fill:none;stroke:${muted};stroke-width:1.3}
      .g-btext{fill:#1f2328;font-size:12px;font-weight:600} .g-blabel{fill:${text};font-size:12px} .g-h{fill:transparent}
      .g-knob{opacity:0} .g-h{opacity:0}
      text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
    </style>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${HEAD + H}" viewBox="0 0 ${Math.ceil(W)} ${HEAD + H}">${style}<defs><marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="${muted}"/></marker></defs>${body}${tl}</svg>`;
  }

  rowIds(): string[] {
    return this.geo?.rows.map((r) => r.node.id) ?? [];
  }

  private rowsForData(): Row[] {
    return this.build()?.rows ?? [];
  }

  csv(): string {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ["Task,Level,Start,Due,Days,Progress %,Priority,Assignee,Starts after"];
    for (const r of this.rowsForData()) {
      const after = (r.node.plan?.after ?? []).map((a) => oneLine(findByAnchor(this.app.root, a)?.text ?? "")).filter(Boolean).join("; ");
      lines.push(
        [q(oneLine(r.node.text)), r.depth, dayStr(r.start), dayStr(r.due), r.due - r.start + 1, r.progress ?? "", r.node.plan?.priority ? "P" + r.node.plan.priority : "", q(r.node.plan?.who ?? ""), q(after)].join(","),
      );
    }
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  ics(): string {
    const fold = (s: string) => s.replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ramify//Gantt//EN", "CALSCALE:GREGORIAN"];
    walk(this.app.top, (n) => {
      const s = span(n.plan);
      if (!s.start || !s.due) return;
      out.push(
        "BEGIN:VEVENT",
        `UID:${n.anchor ?? n.id}@ramify`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${s.start.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${addDays(s.due, 1).replace(/-/g, "")}`,
        `SUMMARY:${fold(oneLine(n.text))}`,
        ...(n.plan?.who ? [`DESCRIPTION:${fold("Assignee: " + n.plan.who)}`] : []),
        "END:VEVENT",
      );
    });
    out.push("END:VCALENDAR");
    return out.join("\r\n") + "\r\n";
  }

  private async export(kind: "png" | "jpg" | "pdf" | "csv" | "ics") {
    const base = (oneLine(this.app.top.text) || "Gantt").replace(/[\\/:*?"<>|]/g, "-") + " – Gantt";
    try {
      let saved: string | null = null;
      const store = this.app.store;
      if (kind === "csv") saved = await store.exportFile(base + ".csv", this.csv(), { name: "CSV (Excel)", extensions: ["csv"] });
      else if (kind === "ics") saved = await store.exportFile(base + ".ics", this.ics(), { name: "Calendar", extensions: ["ics"] });
      else {
        const bytes = await this.raster(kind);
        if (!bytes) return this.app.toast("No tasks with dates to export");
        const ext = kind === "jpg" ? "jpg" : kind;
        saved = await store.exportFile(`${base}.${ext}`, bytes, { name: kind.toUpperCase(), extensions: [ext] });
      }
      if (saved) this.app.toast("Exported " + saved.split(/[\\/]/).pop());
    } catch (err) {
      this.app.toast("Export failed: " + String(err));
    }
  }

  private async raster(kind: "png" | "jpg" | "pdf"): Promise<Uint8Array | null> {
    const svg = this.exportSVG();
    if (!svg) return null;
    const { svgToCanvas } = await import("./exporter");
    const { canvas, w, h } = await svgToCanvas(svg, kind === "pdf" ? 2.5 : 2);
    if (kind === "pdf") {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w, h], compress: true });
      doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
      doc.setProperties({ title: oneLine(this.app.top.text) + " – Gantt", creator: "Ramify" });
      return new Uint8Array(doc.output("arraybuffer"));
    }
    const type = kind === "jpg" ? "image/jpeg" : "image/png";
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, 0.92));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Print: makes a PDF of the chart and opens it in the system viewer (Preview on a Mac). */
  private async print() {
    const bytes = await this.raster("pdf");
    if (!bytes) return this.app.toast("No tasks with dates to print");
    const name = `.ramify-print/${(oneLine(this.app.top.text) || "Gantt").replace(/[\\/:*?"<>|]/g, "-")} – Gantt.pdf`;
    if (this.app.store.canReveal()) {
      await this.app.store.writeBytes(name, bytes);
      await this.app.store.openFile(name);
      this.app.toast("Opened the chart as a PDF: print it from there (⌘P)");
    } else {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      window.open(url, "_blank");
    }
  }
}

function oneLine(t: string) {
  return t.split("\n")[0];
}
function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
