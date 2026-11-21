import { escapeHtml } from "./app";

export interface PaletteItem {
  label: string;
  hint: string;
  keys: string;
  extra?: string; // searchable but not shown (e.g. note text)
  weak?: boolean; // shown only when the query matches
  swatch?: string; // CSS colour for a dot before the label, or "auto"
  run: () => unknown;
}

/** Fuzzy subsequence score; higher is better, -1 = no match. */
export function fuzzy(q: string, s: string): number {
  if (!q) return 0;
  const ql = q.toLowerCase(),
    sl = s.toLowerCase();
  const idx = sl.indexOf(ql);
  if (idx >= 0) return 1000 - idx * 2 - (sl.length - ql.length) * 0.1 + (idx === 0 || /\W/.test(sl[idx - 1]) ? 200 : 0);
  let si = 0,
    score = 0,
    prev = -2;
  for (const ch of ql) {
    if (ch === " ") continue;
    const f = sl.indexOf(ch, si);
    if (f < 0) return -1;
    score += f === prev + 1 ? 8 : f === 0 || /\W/.test(sl[f - 1]) ? 6 : 1;
    prev = f;
    si = f + 1;
  }
  return score;
}

export class Palette {
  private el = document.getElementById("palette")!;
  private input = document.getElementById("pal-input") as HTMLInputElement;
  private list = document.getElementById("pal-list")!;
  private items: PaletteItem[] = [];
  private shown: PaletteItem[] = [];
  private idx = 0;
  private onClose: (() => void) | null = null;

  constructor() {
    this.input.addEventListener("input", () => this.filter());
    this.input.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowDown" || (e.ctrlKey && k === "n")) {
        e.preventDefault();
        this.move(1);
      } else if (k === "ArrowUp" || (e.ctrlKey && k === "p")) {
        e.preventDefault();
        this.move(-1);
      } else if (k === "Enter") {
        e.preventDefault();
        this.choose(this.idx);
      } else if (k === "Escape") {
        e.preventDefault();
        this.close();
      } else if (k === "Tab") e.preventDefault();
    });
    this.el.addEventListener("mousedown", (e) => {
      if (e.target === this.el) {
        e.preventDefault();
        this.close();
      }
    });
    this.list.addEventListener("mousedown", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-i]");
      if (li) {
        e.preventDefault();
        this.choose(Number(li.dataset.i));
      }
    });
  }

  isOpen() {
    return !this.el.hidden;
  }

  open(items: PaletteItem[], placeholder: string, onClose?: () => void) {
    this.items = items;
    this.onClose = onClose ?? null;
    this.input.placeholder = placeholder;
    this.input.value = "";
    this.el.hidden = false;
    this.filter();
    this.input.focus();
  }

  confirm(message: string, okLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (!done) (done = true), resolve(v);
      };
      this.open(
        [
          { label: okLabel, hint: "", keys: "↩", run: () => finish(true) },
          { label: "Cancel", hint: "", keys: "Esc", run: () => finish(false) },
        ],
        message,
        () => finish(false),
      );
      this.input.readOnly = true;
    });
  }

  close() {
    this.el.hidden = true;
    this.input.readOnly = false;
    const cb = this.onClose;
    this.onClose = null;
    cb?.();
  }

  private filter() {
    const q = this.input.value.trim();
    if (!q) this.shown = this.items.filter((i) => !i.weak).slice(0, 200);
    else {
      const scored = this.items
        .map((it) => {
          const a = fuzzy(q, it.label);
          const b = fuzzy(q, it.hint);
          const c = it.extra ? fuzzy(q, it.extra) : -1;
          const s = Math.max(a, b >= 0 ? b * 0.5 : -1, c >= 0 ? c * 0.3 : -1);
          return { it, s };
        })
        .filter((x) => x.s >= 0)
        .sort((x, y) => y.s - x.s);
      this.shown = scored.slice(0, 200).map((x) => x.it);
    }
    this.idx = 0;
    this.draw();
  }

  private draw() {
    this.list.innerHTML = this.shown.length
      ? this.shown
          .map(
            (it, i) =>
              `<li data-i="${i}" class="${i === this.idx ? "on" : ""}">${it.swatch ? `<span class="sw${it.swatch === "auto" ? " auto" : ""}"${it.swatch === "auto" ? "" : ` style="background:${escapeHtml(it.swatch)}"`}></span>` : ""}<span class="pl">${escapeHtml(it.label)}</span><span class="ph">${escapeHtml(it.hint)}</span>${it.keys ? `<kbd>${escapeHtml(it.keys)}</kbd>` : ""}</li>`,
          )
          .join("")
      : `<li class="none">No matches</li>`;
    this.list.querySelector("li.on")?.scrollIntoView({ block: "nearest" });
  }

  private move(d: number) {
    if (!this.shown.length) return;
    this.idx = (this.idx + d + this.shown.length) % this.shown.length;
    this.draw();
  }

  private choose(i: number) {
    const it = this.shown[i];
    if (!it) return;
    this.onClose = null; // the action decides where focus goes
    this.el.hidden = true;
    this.input.readOnly = false;
    void Promise.resolve(it.run()).finally(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === this.input) document.getElementById("sink")?.focus({ preventScroll: true });
    });
  }
}
