import {
  MapNode, History, find, makeNode, addChild, addSibling, remove, indent, outdent, moveSibling,
  cycleTask, setCollapsedAll, visibleOrder, pathTo, reId, walk, isAncestor,
} from "./model";
import { parseMarkdown, serializeMarkdown, branchToMarkdown, parsePastedText } from "./markdown";
import { toOPML, fromOPML } from "./opml";
import { Store, MapEntry, createStore, fileNameFor } from "./storage";
import { chord, prettyChord } from "./keys";
import { LayoutKind } from "./layout";
import { MapView } from "./mapview";
import { OutlineView } from "./outline";
import { Palette, PaletteItem } from "./palette";
import { exportSVG, exportPNG } from "./exporter";
import { COLOR_NAMES, cssColor, hexColor, resolveColors } from "./colors";

export interface Command {
  id: string;
  title: string;
  keys?: string[];
  group: string;
  run: () => unknown;
  /** Only in selection mode (not while typing in a topic). Default true. */
  navOnly?: boolean;
  hidden?: boolean;
  /** In the palette but not listed on the help screen. */
  noHelp?: boolean;
}

type View = "map" | "outline";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const PREFS_KEY = "lm:prefs";

function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class App {
  store: Store = createStore();
  root: MapNode = makeNode("Untitled");
  frontmatter = "";
  fileName: string | null = null;
  sel: string | null = null;
  editing: string | null = null;
  focusId: string | null = null;
  view: View = "map";
  layout: LayoutKind = "mindmap";
  notesOpen = false;
  sidebarOpen = true;
  theme: "auto" | "light" | "dark" = "auto";

  history = new History();
  maps: MapEntry[] = [];
  private saveTimer = 0;
  private dirty = false;
  private lastSaved = "";
  private saving: Promise<void> = Promise.resolve();

  mapView!: MapView;
  outline!: OutlineView;
  palette!: Palette;
  commands: Command[] = [];
  private byChord = new Map<string, Command[]>();
  sink!: HTMLTextAreaElement;

  async start() {
    this.loadPrefs();
    this.mapView = new MapView(this, $("map-view"));
    this.outline = new OutlineView(this, $("outline-view"));
    this.palette = new Palette();
    this.buildCommands();
    this.wireChrome();
    this.wireSink();
    document.addEventListener("keydown", (e) => this.onKey(e), true);
    window.addEventListener("focus", () => this.checkExternalChange());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flush();
      else this.checkExternalChange();
    });
    window.addEventListener("beforeunload", () => this.flush());
    if (this.store.kind === "desktop") {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().onCloseRequested(async () => {
          await this.flush();
        });
      } catch {
        /* older runtime: beforeunload covers most cases */
      }
    }
    this.applyTheme();
    await this.refreshList();
    const last = localStorage.getItem("lm:last");
    if (this.store.hasFolder()) {
      if (last && this.maps.some((m) => m.name === last)) await this.open(last);
      else if (this.maps.length) await this.open(this.maps[0].name);
      else await this.newMap(this.store.kind === "browser" ? demoMap() : undefined);
    }
    this.render();
    if (!this.editing) this.focusSink();
  }

  // ---------------------------------------------------------------- prefs
  private loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (p.layout) this.layout = p.layout;
      if (p.view) this.view = p.view;
      if (p.theme) this.theme = p.theme;
      if (typeof p.sidebarOpen === "boolean") this.sidebarOpen = p.sidebarOpen;
      if (typeof p.notesOpen === "boolean") this.notesOpen = p.notesOpen;
    } catch {
      /* ignore */
    }
  }
  private savePrefs() {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ layout: this.layout, view: this.view, theme: this.theme, sidebarOpen: this.sidebarOpen, notesOpen: this.notesOpen }),
    );
  }
  applyTheme() {
    if (this.theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = this.theme;
  }

  // ---------------------------------------------------------------- accessors
  get top(): MapNode {
    return (this.focusId && find(this.root, this.focusId)?.node) || this.root;
  }
  node(id: string | null): MapNode | null {
    return id ? find(this.root, id)?.node ?? null : null;
  }
  get selNode() {
    return this.node(this.sel);
  }

  // ---------------------------------------------------------------- mutation
  /** Run a structural change with undo + save + render. */
  mutate(fn: () => string | null | void | boolean, opts: { edit?: boolean } = {}) {
    const before = JSON.stringify(this.root);
    const prevSel = this.sel;
    const r = fn();
    if (JSON.stringify(this.root) === before) return r;
    this.history.pushRaw(before, prevSel);
    if (typeof r === "string") this.sel = r;
    this.ensureSelVisible();
    this.markDirty();
    this.render();
    if (opts.edit && this.sel) this.startEdit(this.sel, "end");
    return r;
  }

  /** Text edits push one undo step per editing session (see startEdit). */
  setText(id: string, text: string) {
    const n = this.node(id);
    if (!n || n.text === text) return;
    n.text = text;
    this.markDirty();
  }

  setNote(id: string, note: string) {
    const n = this.node(id);
    if (!n || n.note === note) return;
    n.note = note;
    this.markDirty();
  }

  private ensureSelVisible() {
    if (!this.sel || !find(this.root, this.sel)) this.sel = this.top.id;
    // If selection is outside focus, drop focus.
    if (this.focusId && !isAncestor(this.root, this.focusId, this.sel)) this.focusId = null;
    // If an ancestor is collapsed, select that ancestor.
    const path = pathTo(this.root, this.sel);
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].collapsed) {
        this.sel = path[i].id;
        break;
      }
    }
  }

  select(id: string | null, opts: { scroll?: boolean } = {}) {
    if (this.editing && this.editing !== id) this.stopEdit();
    this.sel = id;
    this.renderSelection();
    if (opts.scroll !== false && id) this.mapView.ensureVisible(id);
  }

  // ---------------------------------------------------------------- editing
  startEdit(id: string, caret: "end" | "start" | "all" | { replace: string } = "end") {
    const n = this.node(id);
    if (!n) return;
    if (this.editing && this.editing !== id) this.stopEdit();
    this.sel = id;
    if (this.editing !== id) {
      this.history.push(this.root, id);
      this.editing = id;
    }
    if (typeof caret === "object") {
      n.text = caret.replace;
      this.markDirty();
    }
    this.renderSelection();
    if (this.view === "map") this.mapView.beginEdit(id, caret);
    else this.outline.focusRow(id, typeof caret === "object" ? "end" : caret);
  }

  /** Leave edit mode. Removes a topic that was left empty (except root). */
  stopEdit(opts: { keepEmpty?: boolean } = {}) {
    const id = this.editing;
    if (!id) return;
    this.editing = null;
    if (this.view === "map") this.mapView.endEdit(id);
    else this.outline.endEdit(id);
    const l = find(this.root, id);
    if (l && l.parent && !l.node.text.trim() && !l.node.children.length && !l.node.note && !opts.keepEmpty) {
      this.sel = remove(this.root, id);
      this.markDirty();
      this.render();
    } else {
      this.mapView.relayout();
    }
    this.renderSelection();
    this.focusSink();
  }

  focusSink() {
    if (this.palette.isOpen()) return;
    if (document.activeElement === $("notes-text")) return;
    this.sink.focus({ preventScroll: true });
  }

  /** Keys handled inside an edited topic (map view or outline row). Return true if consumed. */
  editKey(e: KeyboardEvent, id: string, caretAtStart: boolean, caretAtEnd: boolean): boolean {
    const c = chord(e);
    const n = this.node(id);
    if (!n) return false;
    const l = find(this.root, id)!;
    switch (c) {
      case "Enter": {
        e.preventDefault();
        if (!n.text.trim() && l.parent && l.depth > 1 && !n.children.length && this.isLastChild(id)) {
          this.mutate(() => void outdent(this.root, id));
          this.startEdit(id, "end");
          return true;
        }
        if (!n.text.trim() && l.parent && !n.children.length) {
          this.stopEdit();
          return true;
        }
        this.stopEdit({ keepEmpty: true });
        // Outline convention: Enter on an expanded topic with children adds a first child.
        const asChild = !l.parent || (this.view === "outline" && n.children.length > 0 && !n.collapsed);
        this.mutate(() => (asChild ? addChild(this.root, id, "", 0) : addSibling(this.root, id)), { edit: true });
        return true;
      }
      case "Tab":
        e.preventDefault();
        if (l.parent && l.index > 0) {
          this.mutate(() => void indent(this.root, id));
          this.startEdit(id, "end");
        }
        return true;
      case "Shift+Tab":
        e.preventDefault();
        if (l.depth > 1) {
          this.mutate(() => void outdent(this.root, id));
          this.startEdit(id, "end");
        }
        return true;
      case "Escape":
        e.preventDefault();
        this.stopEdit();
        return true;
      case "Backspace":
        if (!n.text && l.parent && !n.children.length && caretAtStart) {
          e.preventDefault();
          const order = visibleOrder(this.top);
          const i = order.findIndex((x) => x.id === id);
          const prev = order[i - 1];
          this.editing = null;
          this.mutate(() => remove(this.root, id));
          if (prev) this.startEdit(prev.id, "end");
          else this.focusSink();
          return true;
        }
        return false;
      case "ArrowUp":
      case "ArrowDown": {
        if (this.view !== "outline") return false;
        if ((c === "ArrowUp" && !caretAtStart && n.text.includes("\n")) || (c === "ArrowDown" && !caretAtEnd && n.text.includes("\n"))) return false;
        e.preventDefault();
        const order = visibleOrder(this.top);
        const i = order.findIndex((x) => x.id === id);
        const next = order[i + (c === "ArrowUp" ? -1 : 1)];
        if (next) this.startEdit(next.id, "end");
        return true;
      }
    }
    return false;
  }

  private isLastChild(id: string) {
    const l = find(this.root, id);
    return !!l && !!l.parent && l.index === l.parent.children.length - 1;
  }

  // ---------------------------------------------------------------- keyboard
  private onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (this.palette.isOpen()) return; // palette handles its own keys
    const helpEl = $("help");
    if (!helpEl.hidden) {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        helpEl.hidden = true;
        this.focusSink();
      }
      return;
    }
    const c = chord(e);
    const inNotes = document.activeElement === $("notes-text");
    const inFilter = document.activeElement === $("sb-filter");
    if (inNotes && c === "Escape") {
      e.preventDefault();
      ($("notes-text") as HTMLTextAreaElement).blur();
      this.focusSink();
      return;
    }
    if (inFilter) {
      if (c === "Escape" || c === "Enter") {
        e.preventDefault();
        if (c === "Enter") {
          const first = $("sb-list").querySelector<HTMLElement>("li[data-name]");
          if (first) void this.open(first.dataset.name!);
        }
        this.focusSink();
      }
      return;
    }
    const typing = !!this.editing || inNotes;
    const list = this.byChord.get(c);
    if (list) {
      const cmd = list.find((x) => !(typing && x.navOnly !== false));
      if (cmd) {
        e.preventDefault();
        e.stopPropagation();
        void cmd.run();
        return;
      }
    }
  }

  private wireSink() {
    const s = $("sink") as HTMLTextAreaElement | null;
    this.sink = s ?? document.createElement("textarea");
    if (!s) {
      this.sink.id = "sink";
      this.sink.setAttribute("aria-hidden", "true");
      this.sink.tabIndex = -1;
      document.body.appendChild(this.sink);
    }
    let composing = false;
    // Typing a character while a topic is selected starts editing it with that text.
    const takeInput = () => {
      const v = this.sink.value;
      this.sink.value = "";
      if (!v || !this.sel) return;
      this.startEdit(this.sel, { replace: v });
    };
    this.sink.addEventListener("compositionstart", () => (composing = true));
    this.sink.addEventListener("compositionend", () => {
      composing = false;
      takeInput();
    });
    this.sink.addEventListener("input", () => {
      if (!composing) takeInput();
    });
    this.sink.addEventListener("copy", (e) => {
      const n = this.selNode;
      if (!n) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", branchToMarkdown(n));
    });
    this.sink.addEventListener("cut", (e) => {
      const n = this.selNode;
      if (!n) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", branchToMarkdown(n));
      if (n !== this.root) this.mutate(() => remove(this.root, n.id));
    });
    this.sink.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") ?? "";
      this.pasteText(text);
    });
  }

  pasteText(text: string) {
    const nodes = parsePastedText(text);
    if (!nodes.length || !this.sel) return;
    const target = this.sel;
    this.mutate(() => {
      const l = find(this.root, target)!;
      l.node.collapsed = false;
      l.node.children.push(...nodes.map(reId));
      return l.node.children[l.node.children.length - nodes.length].id;
    });
    this.toast(`Pasted ${nodes.length} topic${nodes.length > 1 ? "s" : ""}`);
  }

  // ---------------------------------------------------------------- navigation
  nav(dir: "left" | "right" | "up" | "down") {
    const cur = this.sel ?? this.top.id;
    const n = this.node(cur);
    if (!n) return;
    if (this.view === "outline") {
      const order = visibleOrder(this.top);
      const i = order.findIndex((x) => x.id === cur);
      if (dir === "up" && i > 0) this.select(order[i - 1].id);
      if (dir === "down" && i < order.length - 1) this.select(order[i + 1].id);
      if (dir === "left") {
        if (n.children.length && !n.collapsed && n !== this.top) this.mutate(() => void (n.collapsed = true));
        else {
          const l = find(this.root, cur);
          if (l?.parent && n !== this.top) this.select(l.parent.id);
        }
      }
      if (dir === "right") {
        if (n.collapsed) this.mutate(() => void (n.collapsed = false));
        else if (n.children.length) this.select(n.children[0].id);
      }
      return;
    }
    const next = this.mapView.spatialNeighbor(cur, dir);
    if (next === "expand") this.mutate(() => void (n.collapsed = false));
    else if (next) this.select(next);
  }

  // ---------------------------------------------------------------- render
  render() {
    this.ensureSelVisible();
    const app = $("app");
    app.classList.toggle("no-sidebar", !this.sidebarOpen);
    $("notes").hidden = !this.notesOpen;
    $("map-view").hidden = this.view !== "map";
    $("outline-view").hidden = this.view !== "outline";
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === this.view));
    if (this.view === "map") this.mapView.render();
    else this.outline.render();
    this.renderCrumbs();
    this.renderNotes();
    this.renderSidebar();
  }

  renderSelection() {
    if (this.view === "map") this.mapView.renderSelection();
    else this.outline.renderSelection();
    this.renderNotes();
  }

  private renderCrumbs() {
    const nav = $("crumbs");
    nav.innerHTML = "";
    const path = this.focusId ? pathTo(this.root, this.focusId) : [this.root];
    path.forEach((n, i) => {
      if (i) nav.append(Object.assign(document.createElement("span"), { className: "sep", textContent: "›" }));
      const b = document.createElement("button");
      b.textContent = n.text.split("\n")[0] || "Untitled";
      b.className = i === path.length - 1 ? "cur" : "";
      b.onclick = () => {
        this.focusId = n === this.root ? null : n.id;
        this.render();
        this.mapView.fit();
      };
      nav.append(b);
    });
    if (this.focusId) nav.append(Object.assign(document.createElement("span"), { className: "focus-tag", textContent: "Focus" }));
  }

  private renderNotes() {
    if (!this.notesOpen) return;
    const n = this.selNode;
    const ta = $("notes-text") as HTMLTextAreaElement;
    $("notes-title").textContent = n ? n.text.split("\n")[0] || "Untitled" : "";
    if (document.activeElement !== ta || ta.dataset.id !== n?.id) {
      ta.value = n?.note ?? "";
      ta.dataset.id = n?.id ?? "";
    }
    ta.disabled = !n;
  }

  renderSidebar() {
    $("sb-folder").textContent = this.store.folderLabel();
    const ul = $("sb-list");
    const q = ($("sb-filter") as HTMLInputElement).value.trim().toLowerCase();
    ul.innerHTML = "";
    if (!this.store.hasFolder()) {
      const li = document.createElement("li");
      li.className = "sb-empty";
      li.textContent = "Choose a folder to keep your maps in.";
      ul.append(li);
      return;
    }
    const sorted = [...this.maps].sort((a, b) => b.mtime - a.mtime).filter((m) => !q || m.name.toLowerCase().includes(q));
    for (const m of sorted) {
      const li = document.createElement("li");
      li.dataset.name = m.name;
      li.className = m.name === this.fileName ? "cur" : "";
      const t = document.createElement("span");
      t.textContent = m.name.replace(/\.md$/i, "");
      const d = document.createElement("small");
      d.textContent = relTime(m.mtime);
      li.append(t, d);
      li.onclick = () => void this.open(m.name);
      ul.append(li);
    }
  }

  toast(msg: string) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => (t.hidden = true), 2200);
  }

  private setSaveState(s: string) {
    $("save-state").textContent = s;
  }

  // ---------------------------------------------------------------- files
  markDirty() {
    this.dirty = true;
    this.setSaveState("Editing…");
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 600);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (this.dirty) await this.save();
    await this.saving;
  }

  async save() {
    const run = async () => {
      if (!this.dirty || !this.store.hasFolder()) return;
      this.dirty = false;
      const text = serializeMarkdown(this.root, this.frontmatter);
      try {
        const wanted = fileNameFor(this.root.text);
        if (!this.fileName) {
          this.fileName = this.uniqueName(wanted);
        } else if (wanted !== this.fileName && wanted.toLowerCase() !== this.fileName.toLowerCase()) {
          const target = this.uniqueName(wanted, this.fileName);
          try {
            await this.store.rename(this.fileName, target);
            this.fileName = target;
          } catch {
            /* keep old name */
          }
        }
        await this.store.write(this.fileName, text);
        this.lastSaved = text;
        localStorage.setItem("lm:last", this.fileName);
        this.setSaveState("Saved");
        await this.refreshList();
        this.renderSidebar();
      } catch (err) {
        this.dirty = true;
        this.setSaveState("Not saved");
        this.toast("Save failed: " + String(err));
      }
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  private uniqueName(wanted: string, current?: string) {
    const taken = new Set(this.maps.map((m) => m.name.toLowerCase()));
    if (current) taken.delete(current.toLowerCase());
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const base = wanted.replace(/\.md$/i, "");
    for (let i = 2; ; i++) {
      const n = `${base} ${i}.md`;
      if (!taken.has(n.toLowerCase())) return n;
    }
  }

  async refreshList() {
    try {
      this.maps = await this.store.list();
    } catch (err) {
      this.maps = [];
      this.toast("Cannot read folder: " + String(err));
    }
  }

  loadDoc(text: string, name: string | null) {
    const parsed = parseMarkdown(text, name ? name.replace(/\.md$/i, "") : "Untitled");
    this.root = parsed.root;
    this.frontmatter = parsed.frontmatter;
    this.fileName = name;
    this.lastSaved = text;
    this.dirty = false;
    this.sel = this.root.id;
    this.editing = null;
    this.focusId = null;
    this.history.clear();
  }

  async open(name: string) {
    await this.flush();
    try {
      const text = await this.store.read(name);
      this.loadDoc(text, name);
      localStorage.setItem("lm:last", name);
      this.setSaveState("");
      this.render();
      this.mapView.fit(true);
      this.focusSink();
    } catch (err) {
      this.toast("Cannot open: " + String(err));
    }
  }

  async newMap(root?: MapNode) {
    if (!this.store.hasFolder()) {
      if (!(await this.chooseFolder())) return;
    }
    await this.flush();
    this.root = root ?? makeNode(`Notes ${today()}`);
    this.frontmatter = "";
    this.fileName = null;
    this.focusId = null;
    this.sel = this.root.id;
    this.history.clear();
    this.dirty = true;
    await this.save();
    this.render();
    this.mapView.fit(true);
    if (!root) this.startEdit(this.root.id, "all");
  }

  async chooseFolder() {
    await this.flush();
    const ok = await this.store.chooseFolder();
    if (!ok) return false;
    this.fileName = null;
    await this.refreshList();
    if (this.maps.length) await this.open([...this.maps].sort((a, b) => b.mtime - a.mtime)[0].name);
    else await this.newMap();
    this.render();
    return true;
  }

  private async checkExternalChange() {
    if (!this.fileName || this.dirty || this.editing) return;
    try {
      const text = await this.store.read(this.fileName);
      await this.refreshList();
      this.renderSidebar();
      if (text === this.lastSaved) return;
      const selPath = this.sel ? indexPath(this.root, this.sel) : [];
      const focusPath = this.focusId ? indexPath(this.root, this.focusId) : null;
      this.history.push(this.root, this.sel);
      const parsed = parseMarkdown(text, this.fileName.replace(/\.md$/i, ""));
      this.root = parsed.root;
      this.frontmatter = parsed.frontmatter;
      this.lastSaved = text;
      this.sel = nodeAtPath(this.root, selPath)?.id ?? this.root.id;
      this.focusId = focusPath ? nodeAtPath(this.root, focusPath)?.id ?? null : null;
      this.render();
      this.toast("Reloaded — file changed on disk");
    } catch {
      /* file may have been moved */
    }
  }

  async deleteMap() {
    if (!this.fileName) return;
    const name = this.fileName;
    const ok = await this.palette.confirm(`Move “${name.replace(/\.md$/, "")}” to Trash?`, "Move to Trash");
    if (!ok) return;
    clearTimeout(this.saveTimer);
    this.dirty = false;
    await this.saving;
    try {
      await this.store.remove(name);
    } catch (err) {
      this.toast("Delete failed: " + String(err));
      return;
    }
    this.fileName = null;
    await this.refreshList();
    if (this.maps.length) await this.open([...this.maps].sort((a, b) => b.mtime - a.mtime)[0].name);
    else await this.newMap();
    this.toast("Moved to Trash");
  }

  private async importFile() {
    const f = await this.store.importFile([{ name: "Outline", extensions: ["md", "markdown", "txt", "opml", "xml"] }]);
    if (!f) return;
    const base = f.name.replace(/\.[^.]+$/, "");
    let root: MapNode;
    try {
      if (/\.(opml|xml)$/i.test(f.name)) root = fromOPML(f.text, base);
      else if (/\.txt$/i.test(f.name)) {
        root = makeNode(base);
        root.children = parsePastedText(f.text);
      } else root = parseMarkdown(f.text, base).root;
    } catch (err) {
      this.toast("Import failed: " + String(err));
      return;
    }
    await this.newMap(root);
    this.toast("Imported " + f.name);
  }

  private async exportAs(kind: "md" | "opml" | "svg" | "png") {
    await this.flush();
    const top = this.top;
    const base = fileNameFor(top.text).replace(/\.md$/, "");
    try {
      let saved: string | null = null;
      if (kind === "md") saved = await this.store.exportFile(base + ".md", top === this.root ? serializeMarkdown(this.root, this.frontmatter) : serializeMarkdown(top), { name: "Markdown", extensions: ["md"] });
      if (kind === "opml") saved = await this.store.exportFile(base + ".opml", toOPML(top), { name: "OPML", extensions: ["opml"] });
      if (kind === "svg") saved = await this.store.exportFile(base + ".svg", exportSVG(this), { name: "SVG image", extensions: ["svg"] });
      if (kind === "png") saved = await this.store.exportFile(base + ".png", await exportPNG(this), { name: "PNG image", extensions: ["png"] });
      if (saved) this.toast("Exported " + saved.split(/[\\/]/).pop());
    } catch (err) {
      this.toast("Export failed: " + String(err));
    }
  }

  // ---------------------------------------------------------------- commands
  private buildCommands() {
    const sel = () => this.sel ?? this.top.id;
    const isTop = () => sel() === this.top.id;
    const C: Command[] = [
      // Topics
      { id: "add-child", group: "Topics", title: "New child topic", keys: ["Tab"], run: () => this.mutate(() => addChild(this.root, sel()), { edit: true }) },
      { id: "add-sibling", group: "Topics", title: "New topic below", keys: ["Enter"], run: () => this.mutate(() => addSibling(this.root, sel()), { edit: true }) },
      { id: "add-sibling-above", group: "Topics", title: "New topic above", keys: ["Shift+Enter"], run: () => this.mutate(() => addSibling(this.root, sel(), true), { edit: true }) },
      { id: "edit", group: "Topics", title: "Edit topic", keys: ["Space", "F2"], run: () => this.startEdit(sel(), "end") },
      { id: "delete", group: "Topics", title: "Delete topic", keys: ["Backspace", "Delete"], run: () => !isTop() && this.mutate(() => remove(this.root, sel())) },
      { id: "indent", group: "Topics", title: "Move into previous topic", keys: ["Alt+ArrowRight"], run: () => this.mutate(() => void indent(this.root, sel())) },
      { id: "outdent", group: "Topics", title: "Move out one level", keys: ["Alt+ArrowLeft"], run: () => this.mutate(() => void outdent(this.root, sel())) },
      { id: "move-up", group: "Topics", title: "Move topic up", keys: ["Alt+ArrowUp"], run: () => this.mutate(() => void moveSibling(this.root, sel(), -1)) },
      { id: "move-down", group: "Topics", title: "Move topic down", keys: ["Alt+ArrowDown"], run: () => this.mutate(() => void moveSibling(this.root, sel(), 1)) },
      { id: "duplicate", group: "Topics", title: "Duplicate topic", keys: ["Mod+D"], run: () => this.duplicate() },
      { id: "task", group: "Topics", title: "Toggle checkbox (none → todo → done)", keys: ["Mod+Enter"], navOnly: false, run: () => this.mutate(() => void cycleTask(this.node(sel())!)) },
      { id: "collapse", group: "Topics", title: "Fold / unfold branch", keys: ["Mod+."], navOnly: false, run: () => this.toggleCollapse() },
      { id: "color", group: "Topics", title: "Topic colour…", keys: ["Mod+Shift+C"], navOnly: false, run: () => this.openColorPicker() },
      ...COLOR_NAMES.map((name, i) => ({
        id: "color-" + name, group: "Topics", title: `Colour: ${name}`, keys: [`Alt+${i + 1}`], noHelp: true,
        run: () => this.setColor(name),
      })),
      { id: "color-auto", group: "Topics", title: "Colour: automatic", keys: ["Alt+0"], noHelp: true, run: () => this.setColor(undefined) },
      { id: "color-custom", group: "Topics", title: "Colour: custom…", noHelp: true, run: () => this.customColor() },
      { id: "notes", group: "Topics", title: "Notes for topic", keys: ["Mod+E"], navOnly: false, run: () => this.toggleNotes() },
      { id: "copy", group: "Topics", title: "Copy branch as Markdown", keys: ["Mod+C"], run: () => this.copyBranch(false) },
      { id: "cut", group: "Topics", title: "Cut branch", keys: ["Mod+X"], run: () => this.copyBranch(true) },
      { id: "paste", group: "Topics", title: "Paste outline as child topics", hidden: false, run: () => this.pasteFromClipboard() },
      // Navigate
      { id: "nav-left", group: "Navigate", title: "Select left", keys: ["ArrowLeft"], run: () => this.nav("left"), hidden: true },
      { id: "nav-right", group: "Navigate", title: "Select right", keys: ["ArrowRight"], run: () => this.nav("right"), hidden: true },
      { id: "nav-up", group: "Navigate", title: "Select up", keys: ["ArrowUp"], run: () => this.nav("up"), hidden: true },
      { id: "nav-down", group: "Navigate", title: "Select down", keys: ["ArrowDown"], run: () => this.nav("down"), hidden: true },
      { id: "nav-root", group: "Navigate", title: "Select central topic", keys: ["Home"], run: () => this.select(this.top.id) },
      { id: "search", group: "Navigate", title: "Find topic…", keys: ["Mod+F"], navOnly: false, run: () => this.openSearch() },
      { id: "focus-in", group: "Navigate", title: "Focus on this branch", keys: ["Mod+]"], navOnly: false, run: () => this.focusIn() },
      { id: "focus-out", group: "Navigate", title: "Focus out one level", keys: ["Mod+["], navOnly: false, run: () => this.focusOut() },
      { id: "focus-clear", group: "Navigate", title: "Leave focus mode", run: () => ((this.focusId = null), this.render(), this.mapView.fit()) },
      { id: "expand-all", group: "Navigate", title: "Unfold all", keys: ["Mod+Shift+."], run: () => this.mutate(() => void setCollapsedAll(this.top, false)) },
      { id: "collapse-all", group: "Navigate", title: "Fold all to first level", run: () => this.mutate(() => void setCollapsedAll(this.top, true)) },
      // View
      { id: "palette", group: "View", title: "Command palette", keys: ["Mod+K", "Mod+Shift+P"], navOnly: false, run: () => this.openCommands() },
      { id: "view-map", group: "View", title: "Map view", keys: ["Mod+1"], navOnly: false, run: () => this.setView("map") },
      { id: "view-outline", group: "View", title: "Outline view", keys: ["Mod+2"], navOnly: false, run: () => this.setView("outline") },
      { id: "layout", group: "View", title: "Switch layout (mind map ↔ right tree)", keys: ["Mod+L"], navOnly: false, run: () => this.toggleLayout() },
      { id: "zoom-in", group: "View", title: "Zoom in", keys: ["Mod+="], navOnly: false, run: () => this.mapView.zoomBy(1.2) },
      { id: "zoom-out", group: "View", title: "Zoom out", keys: ["Mod+-"], navOnly: false, run: () => this.mapView.zoomBy(1 / 1.2) },
      { id: "fit", group: "View", title: "Fit map to window", keys: ["Mod+0"], navOnly: false, run: () => this.mapView.fit() },
      { id: "center", group: "View", title: "Center selected topic", keys: ["Mod+J"], run: () => this.sel && this.mapView.center(this.sel) },
      { id: "sidebar", group: "View", title: "Toggle sidebar", keys: ["Mod+B", "Mod+\\"], navOnly: false, run: () => ((this.sidebarOpen = !this.sidebarOpen), this.savePrefs(), this.render()) },
      { id: "theme", group: "View", title: "Theme: auto → light → dark", run: () => this.cycleTheme() },
      { id: "help", group: "View", title: "Keyboard shortcuts", keys: ["?", "F1"], run: () => this.showHelp() },
      // Edit
      { id: "undo", group: "Edit", title: "Undo", keys: ["Mod+Z"], navOnly: true, run: () => this.undo() },
      { id: "redo", group: "Edit", title: "Redo", keys: ["Mod+Shift+Z", "Mod+Y"], navOnly: true, run: () => this.redo() },
      // Maps
      { id: "new", group: "Maps", title: "New map", keys: ["Mod+N"], navOnly: false, run: () => this.newMap() },
      { id: "switch", group: "Maps", title: "Open map…", keys: ["Mod+P", "Mod+O"], navOnly: false, run: () => this.openSwitcher() },
      { id: "rename", group: "Maps", title: "Rename map", keys: ["Mod+R"], navOnly: false, run: () => this.startEdit(this.root.id, "all") },
      { id: "delete-map", group: "Maps", title: "Move map to Trash", run: () => this.deleteMap() },
      { id: "folder", group: "Maps", title: "Choose maps folder…", run: () => void this.chooseFolder() },
      { id: "save", group: "Maps", title: "Save now", keys: ["Mod+S"], navOnly: false, run: () => ((this.dirty = true), this.save()) },
      { id: "import", group: "Maps", title: "Import Markdown / OPML / text…", keys: ["Mod+Shift+O"], navOnly: false, run: () => this.importFile() },
      { id: "export-md", group: "Export", title: "Export Markdown", run: () => this.exportAs("md") },
      { id: "export-opml", group: "Export", title: "Export OPML", run: () => this.exportAs("opml") },
      { id: "export-svg", group: "Export", title: "Export SVG image", run: () => this.exportAs("svg") },
      { id: "export-png", group: "Export", title: "Export PNG image", keys: ["Mod+Shift+E"], navOnly: false, run: () => this.exportAs("png") },
    ];
    this.commands = C;
    for (const c of C) for (const k of c.keys ?? []) {
      if (!this.byChord.has(k)) this.byChord.set(k, []);
      this.byChord.get(k)!.push(c);
    }
  }

  setColor(color: string | undefined) {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    this.mutate(() => {
      if (color) n.color = color;
      else delete n.color;
    });
  }

  private openColorPicker() {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    const current = n.color;
    const items: PaletteItem[] = COLOR_NAMES.map((name, i) => ({
      label: name[0].toUpperCase() + name.slice(1) + (current === name ? "  ✓" : ""),
      hint: "",
      keys: prettyChord(`Alt+${i + 1}`),
      swatch: cssColor(name),
      run: () => this.setColor(name),
    }));
    items.unshift({ label: "Automatic" + (!current ? "  ✓" : ""), hint: "by branch", keys: prettyChord("Alt+0"), swatch: "auto", run: () => this.setColor(undefined) });
    items.push({
      label: "Custom…" + (current?.startsWith("#") ? `  ✓ ${current}` : ""),
      hint: "any colour",
      keys: "",
      swatch: current?.startsWith("#") ? current : "auto",
      run: () => this.customColor(),
    });
    this.palette.open(items, `Colour for “${(n.text.split("\n")[0] || "topic").slice(0, 40)}”`, () => this.focusSink());
  }

  /** Native colour picker; changes apply live and undo as one step. */
  private customColor() {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    const inp = document.createElement("input");
    inp.type = "color";
    const shown = resolveColors(this.top).get(n.id) ?? n.color ?? "blue";
    inp.value = hexColor(shown);
    inp.style.cssText = "position:fixed;left:50%;top:40%;opacity:0;width:1px;height:1px;";
    document.body.append(inp);
    let pushed = false;
    inp.addEventListener("input", () => {
      if (!pushed) {
        this.history.push(this.root, this.sel);
        pushed = true;
      }
      n.color = inp.value.toLowerCase();
      this.markDirty();
      this.render();
    });
    const done = () => {
      inp.remove();
      this.focusSink();
    };
    inp.addEventListener("change", done);
    inp.addEventListener("blur", () => setTimeout(done, 0));
    try {
      (inp as any).showPicker ? (inp as any).showPicker() : inp.click();
    } catch {
      inp.click();
    }
  }

  private duplicate() {
    const l = find(this.root, this.sel ?? "");
    if (!l || !l.parent) return;
    this.mutate(() => {
      const copy = reId(l.node);
      l.parent!.children.splice(l.index + 1, 0, copy);
      return copy.id;
    });
  }

  private toggleCollapse() {
    const n = this.selNode;
    if (!n || !n.children.length || n === this.top) return;
    if (this.editing) this.stopEdit();
    this.mutate(() => void (n.collapsed = !n.collapsed));
  }

  private toggleNotes() {
    const ta = $("notes-text") as HTMLTextAreaElement;
    if (this.notesOpen && document.activeElement === ta) {
      this.notesOpen = false;
      this.savePrefs();
      this.render();
      this.focusSink();
      return;
    }
    if (this.editing) this.stopEdit();
    this.notesOpen = true;
    this.savePrefs();
    this.render();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  private copyBranch(cut: boolean) {
    // Native copy/cut fires on the focused sink textarea; give it a selection so the browser allows it.
    this.sink.value = " ";
    this.sink.select();
    document.execCommand(cut ? "cut" : "copy");
    this.sink.value = "";
    this.toast(cut ? "Cut branch" : "Copied branch as Markdown");
  }

  private async pasteFromClipboard() {
    try {
      this.pasteText(await navigator.clipboard.readText());
    } catch {
      this.toast("Use ⌘V / Ctrl+V to paste");
    }
  }

  private focusIn() {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    if (n === this.root) {
      this.focusId = null;
    } else {
      n.collapsed = false;
      this.focusId = n.id;
    }
    this.render();
    this.mapView.fit();
  }

  private focusOut() {
    if (!this.focusId) return;
    if (this.editing) this.stopEdit();
    const l = find(this.root, this.focusId);
    this.focusId = l?.parent && l.parent !== this.root ? l.parent.id : null;
    this.render();
    this.mapView.fit();
  }

  setView(v: View) {
    if (this.editing) this.stopEdit();
    this.view = v;
    this.savePrefs();
    this.render();
    if (v === "map" && this.sel) this.mapView.ensureVisible(this.sel);
    this.focusSink();
  }

  private toggleLayout() {
    this.layout = this.layout === "mindmap" ? "right" : "mindmap";
    this.savePrefs();
    if (this.view !== "map") this.setView("map");
    this.render();
    this.mapView.fit();
    this.toast(this.layout === "mindmap" ? "Layout: mind map" : "Layout: right tree");
  }

  private cycleTheme() {
    this.theme = this.theme === "auto" ? "light" : this.theme === "light" ? "dark" : "auto";
    this.applyTheme();
    this.savePrefs();
    this.mapView.relayout();
    this.toast("Theme: " + this.theme);
  }

  private undo() {
    const s = this.history.undo(this.root, this.sel);
    if (!s) return;
    this.root = JSON.parse(s.root);
    this.sel = s.sel;
    this.markDirty();
    this.render();
  }
  private redo() {
    const s = this.history.redo(this.root, this.sel);
    if (!s) return;
    this.root = JSON.parse(s.root);
    this.sel = s.sel;
    this.markDirty();
    this.render();
  }

  // ---------------------------------------------------------------- palette
  openCommands() {
    if (this.editing) this.stopEdit();
    const items: PaletteItem[] = this.commands
      .filter((c) => !c.hidden)
      .map((c) => ({ label: c.title, hint: c.group, keys: c.keys?.[0] ? prettyChord(c.keys[0]) : "", run: () => c.run() }));
    for (const m of this.maps) items.push({ label: m.name.replace(/\.md$/i, ""), hint: "Open map", keys: "", run: () => this.open(m.name), weak: true });
    this.palette.open(items, "Type a command or map name…", () => this.focusSink());
  }

  openSearch() {
    if (this.editing) this.stopEdit();
    const items: PaletteItem[] = [];
    walk(this.root, (n) => {
      const path = pathTo(this.root, n.id)
        .slice(1, -1)
        .map((x) => x.text.split("\n")[0])
        .join(" › ");
      items.push({
        label: n.text.split("\n")[0] || "Untitled",
        hint: path,
        keys: "",
        extra: n.note,
        run: () => {
          // Unfold ancestors so the topic is visible.
          for (const p of pathTo(this.root, n.id).slice(0, -1)) p.collapsed = false;
          if (this.focusId && !isAncestor(this.root, this.focusId, n.id)) this.focusId = null;
          this.sel = n.id;
          this.render();
          this.mapView.center(n.id);
        },
      });
    });
    this.palette.open(items, "Find topic…", () => this.focusSink());
  }

  openSwitcher() {
    if (this.editing) this.stopEdit();
    const items: PaletteItem[] = [...this.maps]
      .sort((a, b) => b.mtime - a.mtime)
      .map((m) => ({ label: m.name.replace(/\.md$/i, ""), hint: relTime(m.mtime), keys: "", run: () => this.open(m.name) }));
    items.push({ label: "New map", hint: "", keys: prettyChord("Mod+N"), run: () => this.newMap() });
    this.palette.open(items, "Open map…", () => this.focusSink());
  }

  showHelp() {
    const el = $("help");
    const groups = new Map<string, Command[]>();
    for (const c of this.commands) {
      if ((!c.keys?.length && c.group !== "Navigate") || c.noHelp) continue;
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group)!.push(c);
    }
    const kb = (k: string) => `<kbd>${escapeHtml(prettyChord(k))}</kbd>`;
    let html = `<div class="help-box"><h2>Keyboard shortcuts</h2><div class="help-cols">`;
    html += `<section><h3>While typing in a topic</h3><dl>
      <dt>${kb("Enter")}</dt><dd>Next topic (on an empty topic: move out a level / stop)</dd>
      <dt>${kb("Tab")} ${kb("Shift+Tab")}</dt><dd>Indent / outdent</dd>
      <dt>${kb("Shift+Enter")}</dt><dd>Line break</dd>
      <dt>${kb("Backspace")}</dt><dd>On an empty topic: delete it</dd>
      <dt>${kb("Escape")}</dt><dd>Stop typing</dd></dl></section>`;
    html += `<section><h3>Navigate</h3><dl><dt>${kb("ArrowUp")}${kb("ArrowDown")}${kb("ArrowLeft")}${kb("ArrowRight")}</dt><dd>Move selection</dd><dt><kbd>a–z</kbd></dt><dd>Start typing to replace the topic</dd>`;
    for (const c of groups.get("Navigate") ?? []) if (!c.hidden && c.keys) html += `<dt>${c.keys.map(kb).join(" ")}</dt><dd>${escapeHtml(c.title)}</dd>`;
    html += `</dl></section>`;
    for (const [g, cmds] of groups) {
      if (g === "Navigate") continue;
      html += `<section><h3>${g}</h3><dl>`;
      for (const c of cmds) html += `<dt>${c.keys!.map(kb).join(" ")}</dt><dd>${escapeHtml(c.title)}</dd>`;
      if (g === "Topics") html += `<dt>${kb("Alt+1")}–${kb("Alt+9")}</dt><dd>Set colour (${COLOR_NAMES.join(", ")})</dd><dt>${kb("Alt+0")}</dt><dd>Automatic colour</dd>`;
      html += `</dl></section>`;
    }
    html += `</div><p class="help-foot">Everything else: ${kb("Mod+K")} command palette. ${kb("Escape")} closes this.</p></div>`;
    el.innerHTML = html;
    el.hidden = false;
    el.onclick = (e) => {
      if (e.target === el) {
        el.hidden = true;
        this.focusSink();
      }
    };
  }

  // ---------------------------------------------------------------- chrome
  private wireChrome() {
    $("sb-folder").onclick = () => void (this.store.kind === "desktop" ? this.chooseFolder() : this.toast("The desktop app saves to a folder of .md files."));
    $("sb-new").onclick = () => void this.newMap();
    $("sb-help").onclick = () => this.showHelp();
    $("palette-btn").onclick = () => this.openCommands();
    ($("sb-filter") as HTMLInputElement).oninput = () => this.renderSidebar();
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => (b.onclick = () => this.setView(b.dataset.view as View)));
    $("notes-close").onclick = () => {
      this.notesOpen = false;
      this.savePrefs();
      this.render();
      this.focusSink();
    };
    const ta = $("notes-text") as HTMLTextAreaElement;
    let pushed = false;
    ta.addEventListener("focus", () => (pushed = false));
    ta.addEventListener("input", () => {
      const id = ta.dataset.id;
      if (!id) return;
      if (!pushed) {
        this.history.push(this.root, this.sel);
        pushed = true;
      }
      this.setNote(id, ta.value);
      this.mapView.updateNode(id);
    });
    // Click on empty stage returns keyboard focus to the map.
    $("stage").addEventListener("mousedown", (e) => {
      if (e.target === $("stage")) this.focusSink();
    });
  }
}

// ---------------------------------------------------------------- helpers

function indexPath(root: MapNode, id: string): number[] {
  const p = pathTo(root, id);
  const out: number[] = [];
  for (let i = 1; i < p.length; i++) out.push(p[i - 1].children.indexOf(p[i]));
  return out;
}
function nodeAtPath(root: MapNode, path: number[]): MapNode | null {
  let n: MapNode | undefined = root;
  for (const i of path) {
    n = n?.children[Math.min(i, n.children.length - 1)];
    if (!n) return null;
  }
  return n ?? null;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function relTime(ms: number) {
  if (!ms) return "";
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  if (d < 86400 * 7) return Math.floor(d / 86400) + "d";
  return new Date(ms).toLocaleDateString();
}

function demoMap(): MapNode {
  return parseMarkdown(
    `# Welcome to Ramify
> Type to rename a topic. Press ? for every shortcut.

- Make topics
  - Tab → child topic
  - Enter → next topic
  - Just start typing to replace text
- While typing
  - Enter → next topic
  - Tab / Shift+Tab → indent / outdent
  - Enter on an empty topic → step out
  - Esc → stop typing
- Move around
  - Arrow keys
  - ⌘F find, ⌘] focus a branch
- [ ] Try ⌘K for every command
- Your files
  > Every map is a plain Markdown file.
  > Open it in Obsidian, edit it, and the map updates.
  - ⌘2 outline view
  - ⌘E notes on a topic
`,
  ).root;
}
