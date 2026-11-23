// Present mode: full-screen, one slide per main branch.
// Slide 0 = the whole map, then each first-level branch on its own (with its notes as a caption).

import type { App } from "./app";
import { isDesktop } from "./storage";
import { renderNote } from "./notes";

export class Presenter {
  private slides: (string | null)[] = []; // null = overview, else topic id
  private i = 0;
  private bar: HTMLElement | null = null;
  private caption: HTMLElement | null = null;
  private prevFocus: string | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);
  active = false;

  constructor(private app: App) {}

  async start() {
    const app = this.app;
    if (app.editing) app.stopEdit();
    this.prevFocus = app.focusId;
    const top = app.top;
    this.slides = [null, ...top.children.map((c) => c.id)];
    this.i = 0;
    this.active = true;
    document.body.classList.add("presenting");
    this.bar = Object.assign(document.createElement("div"), { className: "present-bar" });
    this.caption = Object.assign(document.createElement("div"), { className: "present-caption" });
    document.body.append(this.caption, this.bar);
    document.addEventListener("keydown", this.onKey, true);
    if (isDesktop()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(true);
      } catch {
        /* not allowed: stay windowed */
      }
    }
    this.show();
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener("keydown", this.onKey, true);
    document.body.classList.remove("presenting");
    this.bar?.remove();
    this.caption?.remove();
    this.app.focusId = this.prevFocus;
    this.app.render();
    this.app.mapView.fit();
    this.app.focusSink();
    if (isDesktop()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(false);
      } catch {
        /* ignore */
      }
    }
  }

  private show() {
    const app = this.app;
    const id = this.slides[this.i];
    const base = this.prevFocus;
    app.focusId = id ?? base;
    if (id) {
      const n = app.node(id);
      if (n) n.collapsed = false;
    }
    app.sel = id ?? app.top.id;
    app.view = "map";
    app.render();
    setTimeout(() => app.mapView.fit(), 30);
    const n = app.node(id ?? app.top.id);
    if (this.caption) {
      if (n?.note.trim()) {
        this.caption.hidden = false;
        renderNote(this.caption, n.note, app.store, app.fileName ?? "", () => {});
      } else this.caption.hidden = true;
    }
    if (this.bar)
      this.bar.innerHTML = `<span>${this.i + 1} / ${this.slides.length}</span><span class="dots">${this.slides
        .map((_, k) => `<i class="${k === this.i ? "on" : ""}"></i>`)
        .join("")}</span><span class="muted">← → to move · Esc to exit</span>`;
  }

  private key(e: KeyboardEvent) {
    const k = e.key;
    const next = ["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(k);
    const prev = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k);
    if (next || prev || k === "Escape" || k === "Home" || k === "End") {
      e.preventDefault();
      e.stopPropagation();
    } else return;
    if (k === "Escape") return void this.stop();
    if (next && this.i < this.slides.length - 1) this.i++;
    else if (prev && this.i > 0) this.i--;
    else if (k === "Home") this.i = 0;
    else if (k === "End") this.i = this.slides.length - 1;
    else return;
    this.show();
  }
}
