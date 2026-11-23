import {
  MapNode, History, find, makeNode, addChild, addSibling, remove, indent, outdent, moveSibling,
  cycleTask, setCollapsedAll, visibleOrder, pathTo, reId, walk, isAncestor, newAnchor, findByAnchor,
  Shape,
} from "./model";
import { parseMarkdown, serializeMarkdown, branchToMarkdown, parsePastedText, headingsMarkdown } from "./markdown";
import { toOPML } from "./opml";
import { Store, MapEntry, createStore, fileNameFor, dirOf, baseOf, relLink, isImage, resolveLink } from "./storage";
import { chord, prettyChord } from "./keys";
import { LayoutKind, LAYOUTS, LINE_STYLES, LineStyle } from "./layout";
import { MapView } from "./mapview";
import { OutlineView } from "./outline";
import { Palette, PaletteItem } from "./palette";
import { exportSVG, exportPNG, exportPDF, exportHTML, exportJSON, exportText } from "./exporter";
import { COLOR_NAMES, cssColor, hexColor, resolveColors } from "./colors";
import { THEMES, applyTheme } from "./themes";
import { renderNote, toggleTask, noteLinks } from "./notes";
import { importAny, IMPORT_EXTENSIONS } from "./importers";
import { Presenter } from "./present";
import { AI_ACTIONS, AIAction, buildPrompt, cleanList, complete, loadAISettings } from "./ai";
import { openAISettings } from "./settings";
import { ICONS } from "./icons";
import { SHAPE_LIST, shapeIcon } from "./shapes";
import { icon } from "./ui-icons";
import { showMenu } from "./menu";
import { Updater, autoCheckEnabled, setAutoCheck, appVersion, RELEASES_URL } from "./updater";
import { openExternal } from "./notes";
import { attachListEditing } from "./listedit";
import { TaskUI } from "./tasks-ui";
import { GanttView } from "./gantt";

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

type View = "map" | "outline" | "gantt";

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
  /** Extra topics picked with Shift-click (summary over siblings, chaining tasks). */
  extra = new Set<string>();
  editing: string | null = null;
  focusId: string | null = null;
  view: View = "map";
  /** Default layout for maps that don't set their own. */
  defaultLayout: LayoutKind = "mindmap";
  /** Layout saved in this map's front matter (ramify-layout), if any. */
  mapLayout: LayoutKind | null = null;
  notesOpen = true;
  notesEditing = false;
  /** Notes take the whole right panel (⌘E); the style controls are hidden. */
  notesFull = false;
  private panelWasClosed = false;
  sidebarOpen = true;
  theme = "system";
  /** "filled": solid coloured topics (default). "outline": outlined topics, coloured lines. */
  mapStyle: "filled" | "outline" = "filled";
  presenter = new Presenter(this);
  updater = new Updater(this);
  tasks = new TaskUI(this);

  history = new History();
  maps: MapEntry[] = [];
  folders: string[] = [];
  collapsedFolders = new Set<string>(JSON.parse(localStorage.getItem("lm:folds") || "[]"));
  private saveTimer = 0;
  private dirty = false;
  private lastSaved = "";
  private saving: Promise<void> = Promise.resolve();

  mapView!: MapView;
  outline!: OutlineView;
  gantt!: GanttView;
  palette!: Palette;
  commands: Command[] = [];
  private byChord = new Map<string, Command[]>();
  sink!: HTMLTextAreaElement;

  async start() {
    this.loadPrefs();
    this.mapView = new MapView(this, $("map-view"));
    this.outline = new OutlineView(this, $("outline-view"));
    this.gantt = new GanttView(this, $("gantt-view"));
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
    // Text colours on filled topics depend on the theme: repaint when the OS switches light/dark.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.theme === "system" && this.mapView.render());
    this.wireFileDrop();
    this.updater.startAutoCheck();
    // Live sync: pick up changes made by other apps / devices (iCloud, Dropbox, Syncthing, git).
    window.setInterval(() => void this.poll(), 3000);
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
      if (p.layout) this.defaultLayout = p.layout;
      if (p.view) this.view = p.view;
      if (p.theme) this.theme = p.theme === "auto" ? "system" : p.theme;
      if (p.mapStyle === "outline" || p.mapStyle === "filled") this.mapStyle = p.mapStyle;
      if (typeof p.sidebarOpen === "boolean") this.sidebarOpen = p.sidebarOpen;
      if (typeof p.notesOpen === "boolean") this.notesOpen = p.notesOpen;
    } catch {
      /* ignore */
    }
  }
  private savePrefs() {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ layout: this.defaultLayout, view: this.view, theme: this.theme, sidebarOpen: this.sidebarOpen, notesOpen: this.notesOpen, mapStyle: this.mapStyle }),
    );
  }
  applyTheme(id = this.theme) {
    applyTheme(id);
    document.body.classList.toggle("style-filled", this.mapStyle === "filled");
  }

  setMapStyle(s: "filled" | "outline") {
    this.mapStyle = s;
    this.savePrefs();
    this.applyTheme();
    this.render();
  }

  get layout(): LayoutKind {
    return this.mapLayout ?? this.defaultLayout;
  }

  /** Branch line style, stored in the map's front matter (ramify-lines). */
  get lines(): LineStyle {
    const m = this.frontmatter.match(/^ramify-lines:\s*(\w+)\s*$/m);
    return m && LINE_STYLES.some((l) => l.id === m[1]) ? (m[1] as LineStyle) : "curved";
  }

  setLines(s: LineStyle) {
    if (s === this.lines) return;
    this.frontmatter = setFrontmatter(this.frontmatter, "ramify-lines", s);
    this.markDirty();
    this.render();
  }

  /** Set this map's layout (stored in its front matter) and make it the default for new maps. */
  setLayout(k: LayoutKind) {
    this.mapLayout = k;
    this.defaultLayout = k;
    this.savePrefs();
    this.frontmatter = setFrontmatter(this.frontmatter, "ramify-layout", k);
    this.markDirty();
    if (this.view !== "map") this.setView("map");
    this.render(); // also refreshes the layout buttons in the style panel
    this.mapView.fit();
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

  select(id: string | null, opts: { scroll?: boolean; add?: boolean } = {}) {
    if (this.editing && this.editing !== id) this.stopEdit();
    if (opts.add && id && this.sel && id !== this.sel) {
      // Shift-click: add or remove a topic from the extra selection.
      if (this.extra.has(id)) this.extra.delete(id);
      else this.extra.add(id);
      this.renderSelection();
      return;
    }
    this.extra.clear();
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
      this.history.forgetEmptyEdit(this.root, id);
      this.markDirty();
      this.render();
    } else {
      this.mapView.relayout();
    }
    this.renderSelection();
    this.renderCrumbs();
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
    if (document.querySelector(".menu, .modal")) return; // menus and dialogs handle their own keys
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
    if (inNotes && c === "Escape" && this.notesFull) {
      e.preventDefault();
      this.closeFullNotes();
      return;
    }
    if (inNotes && c === "Escape") {
      e.preventDefault();
      ($("notes-text") as HTMLTextAreaElement).blur();
      this.notesEditing = false;
      this.renderNotes();
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
    if (this.view === "gantt") {
      const order = this.gantt.rowIds();
      const i = order.indexOf(cur);
      if (dir === "up") this.select(order[Math.max(0, i - 1)] ?? order[0]);
      if (dir === "down") this.select(order[Math.min(order.length - 1, i + 1)] ?? order[0]);
      return;
    }
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
    app.classList.toggle("outline", this.view === "outline");
    app.classList.toggle("gantt", this.view === "gantt");
    $("tb-outline").classList.toggle("on", this.view === "outline");
    $("tb-gantt").classList.toggle("on", this.view === "gantt");
    $("gantt-view").hidden = this.view !== "gantt";
    $("tb-panel").classList.toggle("on", this.notesOpen);
    $("notes").hidden = !this.notesOpen;
    $("notes").classList.toggle("notes-full", this.notesFull);
    $("map-view").hidden = this.view !== "map";
    $("outline-view").hidden = this.view !== "outline";
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => b.classList.toggle("on", b.dataset.view === this.view));
    if (this.view === "map") this.mapView.render();
    else if (this.view === "gantt") this.gantt.render();
    else this.outline.render();
    this.renderCrumbs();
    this.renderNotes();
    this.renderSidebar();
  }

  renderSelection() {
    if (this.view === "map") this.mapView.renderSelection();
    else if (this.view === "gantt") this.gantt.renderSelection();
    else this.outline.renderSelection();
    this.renderNotes();
  }

  private renderCrumbs() {
    $("map-title-text").textContent = this.root.text.split("\n")[0] || "Untitled";
    const nav = $("crumbs");
    nav.innerHTML = "";
    if (!this.focusId) return;
    const path = pathTo(this.root, this.focusId).slice(1);
    path.forEach((n, i) => {
      nav.append(Object.assign(document.createElement("span"), { className: "sep", textContent: "›" }));
      const b = document.createElement("button");
      b.textContent = n.text.split("\n")[0] || "Untitled";
      b.className = i === path.length - 1 ? "cur" : "";
      b.onclick = () => {
        this.focusId = n.id;
        this.render();
        this.mapView.fit();
      };
      nav.append(b);
    });
    const out = Object.assign(document.createElement("button"), { className: "focus-tag", textContent: "Focus ✕", title: "Leave focus (⌘[)" });
    out.onclick = () => {
      this.focusId = null;
      this.render();
      this.mapView.fit();
    };
    nav.append(out);
  }


  renderNotes() {
    if (!this.notesOpen) return;
    this.renderInspector();
    const n = this.selNode;
    const ta = $("notes-text") as HTMLTextAreaElement;
    const pv = $("notes-preview");
    $("notes-title").textContent = n ? n.text.split("\n")[0] || "Untitled" : "";
    const editing = this.notesEditing || !n?.note.trim();
    ta.hidden = !editing;
    pv.hidden = editing;
    if (document.activeElement !== ta || ta.dataset.id !== n?.id) {
      ta.value = n?.note ?? "";
      ta.dataset.id = n?.id ?? "";
    }
    ta.disabled = !n;
    if (!editing && n) {
      const id = n.id;
      renderNote(pv, n.note, this.store, this.fileName ?? "", (i) => {
        const node = this.node(id);
        if (!node) return;
        this.history.push(this.root, this.sel);
        this.setNote(id, toggleTask(node.note, i));
        this.mapView.updateNode(id);
        this.renderNotes();
      });
    }
    $("notes-mode").textContent = editing ? "Preview" : "Edit";
  }

  /** Switch the notes panel between editing and the rendered preview. */
  setNotesEditing(on: boolean) {
    this.notesEditing = on;
    this.renderNotes();
    const ta = $("notes-text") as HTMLTextAreaElement;
    if (on) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
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
    const mapItem = (m: MapEntry, depth: number) => {
      const li = document.createElement("li");
      li.dataset.name = m.name;
      li.className = m.name === this.fileName ? "cur" : "";
      li.style.setProperty("--d", String(depth));
      li.insertAdjacentHTML("afterbegin", icon("map", 15));
      const t = document.createElement("span");
      t.textContent = (q ? m.name : baseOf(m.name)).replace(/\.md$/i, "");
      const d = document.createElement("small");
      d.textContent = relTime(m.mtime);
      const more = document.createElement("button");
      more.className = "sb-more";
      more.title = "More";
      more.innerHTML = icon("more", 15);
      li.append(t, d, more);
      li.onclick = () => void this.open(m.name);
      const menu = (anchor: HTMLElement) => this.mapMenu(anchor, m.name);
      more.onclick = (e) => {
        e.stopPropagation();
        menu(more);
      };
      li.oncontextmenu = (e) => {
        e.preventDefault();
        menu(li);
      };
      ul.append(li);
    };
    if (q) {
      // Filtering: flat list of matching maps, newest first.
      [...this.maps].sort((a, b) => b.mtime - a.mtime).filter((m) => m.name.toLowerCase().includes(q)).forEach((m) => mapItem(m, 0));
      return;
    }
    // Tree: folders first (A–Z), then maps (newest first).
    const rec = (dir: string, depth: number) => {
      const sub = this.folders.filter((f) => dirOf(f) === dir).sort((a, b) => a.localeCompare(b));
      for (const f of sub) {
        const li = document.createElement("li");
        const folded = this.collapsedFolders.has(f);
        li.className = "folder" + (folded ? " folded" : "") + (this.fileName && dirOf(this.fileName).startsWith(f) ? " has-cur" : "");
        li.style.setProperty("--d", String(depth));
        li.dataset.folder = f;
        li.insertAdjacentHTML("afterbegin", `<span class="caret">${icon("chevron", 13)}</span>${icon("folder", 15)}`);
        const t = document.createElement("span");
        t.textContent = baseOf(f);
        const c = document.createElement("small");
        c.textContent = String(this.maps.filter((m) => m.name.startsWith(f + "/")).length || "");
        li.append(t, c);
        li.onclick = () => {
          if (folded) this.collapsedFolders.delete(f);
          else this.collapsedFolders.add(f);
          localStorage.setItem("lm:folds", JSON.stringify([...this.collapsedFolders]));
          this.renderSidebar();
        };
        ul.append(li);
        if (!folded) rec(f, depth + 1);
      }
      this.maps
        .filter((m) => dirOf(m.name) === dir)
        .sort((a, b) => b.mtime - a.mtime)
        .forEach((m) => mapItem(m, depth));
    };
    rec("", 0);
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
        // The file name follows the central topic; the folder stays where it is.
        const dir = this.fileName ? dirOf(this.fileName) : this.newMapDir;
        const wanted = (dir ? dir + "/" : "") + fileNameFor(this.root.text);
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
      const t = await this.store.list();
      this.maps = t.files;
      this.folders = t.folders;
    } catch (err) {
      this.maps = [];
      this.folders = [];
      this.toast("Cannot read folder: " + String(err));
    }
  }

  /** Every few seconds: refresh the sidebar and reload the open map if another app changed it. */
  private async poll() {
    if (document.visibilityState === "hidden" || !this.store.hasFolder() || this.store.kind !== "desktop") return;
    if (this.palette.isOpen() || this.presenter.active) return;
    const before = JSON.stringify([this.maps, this.folders]);
    const cur = this.maps.find((m) => m.name === this.fileName)?.mtime;
    await this.refreshList();
    if (JSON.stringify([this.maps, this.folders]) !== before) this.renderSidebar();
    const now = this.maps.find((m) => m.name === this.fileName)?.mtime;
    if (cur !== undefined && now !== undefined && now !== cur) await this.checkExternalChange();
  }

  loadDoc(text: string, name: string | null) {
    const parsed = parseMarkdown(text, name ? name.replace(/\.md$/i, "") : "Untitled");
    this.root = parsed.root;
    this.frontmatter = parsed.frontmatter;
    this.mapLayout = layoutFrom(parsed.frontmatter);
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

  /** Folder for the next new map: the open map's folder. */
  newMapDir = "";

  async newMap(root?: MapNode, dir?: string, edit = !root) {
    if (!this.store.hasFolder()) {
      if (!(await this.chooseFolder())) return;
    }
    await this.flush();
    this.newMapDir = dir ?? (this.fileName ? dirOf(this.fileName) : "");
    this.root = root ?? makeNode(`Notes ${today()}`);
    this.frontmatter = "";
    this.mapLayout = null;
    this.fileName = null;
    this.focusId = null;
    this.sel = this.root.id;
    this.history.clear();
    this.dirty = true;
    await this.save();
    this.render();
    this.mapView.fit(true);
    if (edit) this.startEdit(this.root.id, "all");
    else this.focusSink();
  }

  /** Today's daily note: Daily/YYYY-MM-DD.md (same naming as Obsidian daily notes). */
  async openDaily() {
    const d = today();
    const name = `Daily/${d}.md`;
    if (this.maps.some((m) => m.name === name)) return this.open(name);
    const root = makeNode(d);
    await this.newMap(root, "Daily", false);
    this.mutate(() => addChild(this.root, this.root.id), { edit: true });
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
      const parsed = parseMarkdown(text, baseOf(this.fileName).replace(/\.md$/i, ""));
      this.root = parsed.root;
      this.frontmatter = parsed.frontmatter;
      this.mapLayout = layoutFrom(parsed.frontmatter);
      this.lastSaved = text;
      this.sel = nodeAtPath(this.root, selPath)?.id ?? this.root.id;
      this.focusId = focusPath ? nodeAtPath(this.root, focusPath)?.id ?? null : null;
      this.render();
      this.toast("Reloaded — file changed on disk");
    } catch {
      /* file may have been moved */
    }
  }

  /** Right-click / "⋯" menu for a map in the sidebar. */
  private mapMenu(anchor: HTMLElement, name: string) {
    const isCur = name === this.fileName;
    showMenu(anchor, [
      { label: "Open", icon: icon("map"), run: () => this.open(name) },
      {
        label: "Rename",
        keys: isCur ? prettyChord("Mod+R") : undefined,
        icon: icon("note"),
        run: async () => {
          if (!isCur) await this.open(name);
          this.startEdit(this.root.id, "all");
        },
      },
      ...(this.store.canReveal() ? [{ label: "Show folder", icon: icon("folder"), run: () => this.store.openFile(dirOf(name)) }] : []),
      { label: "Move to Trash", icon: icon("trash"), run: () => this.deleteMap(name), sep: true },
    ], () => this.focusSink());
  }

  async deleteMap(target?: string) {
    const name = target ?? this.fileName;
    if (!name) return;
    const ok = await this.palette.confirm(`Move “${baseOf(name).replace(/\.md$/, "")}” to Trash?`, "Move to Trash");
    if (!ok) return;
    const isCur = name === this.fileName;
    if (isCur) {
      clearTimeout(this.saveTimer);
      this.dirty = false;
    }
    await this.saving;
    try {
      await this.store.remove(name);
    } catch (err) {
      this.toast("Delete failed: " + String(err));
      return;
    }
    await this.refreshList();
    if (isCur) {
      this.fileName = null;
      if (this.maps.length) await this.open([...this.maps].sort((a, b) => b.mtime - a.mtime)[0].name);
      else await this.newMap();
    }
    this.renderSidebar();
    this.toast("Moved to Trash");
  }

  private async importFile() {
    const f = await this.store.importFile([{ name: "Mind maps and outlines", extensions: IMPORT_EXTENSIONS }]);
    if (!f) return;
    let root: MapNode;
    try {
      root = importAny(f.name, f.text, f.bytes);
    } catch (err) {
      this.toast("Import failed: " + String(err));
      return;
    }
    await this.newMap(root, undefined, false);
    this.toast("Imported " + f.name);
  }

  /** The map as an SVG string (same as Export → SVG). */
  mapSVG(): string {
    return exportSVG(this);
  }

  private async exportAs(kind: "md" | "md-list" | "opml" | "svg" | "png" | "pdf" | "html" | "json" | "txt") {
    await this.flush();
    const top = this.top;
    const base = fileNameFor(top.text).replace(/\.md$/, "");
    try {
      let saved: string | null = null;
      const fm = top === this.root ? this.frontmatter : "";
      if (kind === "md") saved = await this.store.exportFile(base + ".md", headingsMarkdown(top, fm), { name: "Markdown", extensions: ["md"] });
      if (kind === "md-list") saved = await this.store.exportFile(base + ".md", serializeMarkdown(top, fm), { name: "Markdown", extensions: ["md"] });
      if (kind === "opml") saved = await this.store.exportFile(base + ".opml", toOPML(top), { name: "OPML", extensions: ["opml"] });
      if (kind === "svg") saved = await this.store.exportFile(base + ".svg", exportSVG(this), { name: "SVG image", extensions: ["svg"] });
      if (kind === "png") saved = await this.store.exportFile(base + ".png", await exportPNG(this), { name: "PNG image", extensions: ["png"] });
      if (kind === "pdf") saved = await this.store.exportFile(base + ".pdf", await exportPDF(this), { name: "PDF", extensions: ["pdf"] });
      if (kind === "html") saved = await this.store.exportFile(base + ".html", exportHTML(this), { name: "Web page", extensions: ["html"] });
      if (kind === "json") saved = await this.store.exportFile(base + ".json", exportJSON(top), { name: "JSON", extensions: ["json"] });
      if (kind === "txt") saved = await this.store.exportFile(base + ".txt", exportText(top), { name: "Plain text", extensions: ["txt"] });
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
      { id: "shape", group: "Topics", title: "Topic shape…", keys: ["Mod+Shift+S"], navOnly: false, run: () => this.openShapePicker() },
      { id: "icon", group: "Topics", title: "Topic icon…", keys: ["Mod+I"], navOnly: false, run: () => this.openIconPicker() },
      { id: "link", group: "Topics", title: "Link to another topic…", keys: ["Mod+Shift+L"], navOnly: false, run: () => this.linkTo() },
      { id: "goto-link", group: "Topics", title: "Go to linked topic", keys: ["Mod+G"], navOnly: false, run: () => (this.selNode?.xref && !this.selNode.links?.length ? this.tasks.openXref() : this.goToLink()) },
      { id: "link-label", group: "Topics", title: "Text on link…", run: () => this.tasks.labelLinks() },
      { id: "xref", group: "Topics", title: "Link to a topic in another map…", run: () => this.tasks.linkOtherMap() },
      { id: "xref-open", group: "Topics", title: "Open linked map", run: () => this.tasks.openXref() },
      { id: "xref-remove", group: "Topics", title: "Remove link to other map", run: () => this.mutate(() => void delete this.selNode?.xref) },
      { id: "plan", group: "Tasks", title: "Task details (dates, progress, priority)", keys: ["Mod+Shift+K"], navOnly: false, run: () => this.tasks.addPlan() },
      { id: "plan-after", group: "Tasks", title: "Starts after… (predecessor)", run: () => this.tasks.pickPredecessor() },
      { id: "plan-chain", group: "Tasks", title: "Chain selected tasks (Shift-click to pick)", run: () => this.tasks.chain([this.sel!, ...this.extra].filter(Boolean)) },
      { id: "plan-remove", group: "Tasks", title: "Remove task details", run: () => this.tasks.update(() => undefined, true) },
      ...[1, 2, 3, 4, 5].map((p) => ({ id: "pri-" + p, group: "Tasks", title: `Priority P${p}`, noHelp: true, run: () => this.tasks.update((x) => ({ ...x, priority: p })) })),
      ...[0, 25, 50, 75, 100].map((p) => ({ id: "prog-" + p, group: "Tasks", title: `Progress ${p}%`, noHelp: true, run: () => this.tasks.update((x) => ({ ...x, progress: p })) })),
      { id: "labels", group: "Topics", title: "Labels…", keys: ["Mod+Shift+;"], navOnly: false, run: () => this.tasks.editLabels() },
      { id: "boundary", group: "Topics", title: "Boundary around branch", keys: ["Mod+Shift+B"], navOnly: false, run: () => this.tasks.toggleBoundary() },
      { id: "boundary-label", group: "Topics", title: "Boundary label…", run: () => this.tasks.editBoundary() },
      { id: "summary", group: "Topics", title: "Summary of selected topics (Shift-click to pick)", keys: ["Mod+Shift+]"], navOnly: false, run: () => this.tasks.addSummary([this.sel!, ...this.extra].filter(Boolean)) },
      { id: "unlink", group: "Topics", title: "Remove links from topic…", run: () => this.removeLinks() },
      { id: "attach", group: "Topics", title: "Attach files (images, PDFs…)", keys: ["Mod+Shift+A"], navOnly: false, run: () => this.attach() },
      { id: "open-attachment", group: "Topics", title: "Open attachment…", keys: ["Mod+Shift+V"], navOnly: false, run: () => this.openAttachmentPicker() },
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
      { id: "view-gantt", group: "View", title: "Gantt chart", keys: ["Mod+3"], navOnly: false, run: () => this.setView("gantt") },
      ...LINE_STYLES.map((l) => ({ id: "lines-" + l.id, group: "View", title: `Lines: ${l.name.toLowerCase()}`, run: () => this.setLines(l.id) })),
      { id: "layout", group: "View", title: "Layout…", keys: ["Mod+L"], navOnly: false, run: () => this.openLayoutPicker() },
      ...LAYOUTS.map((l) => ({ id: "layout-" + l.id, group: "View", title: `Layout: ${l.name}`, noHelp: true, run: () => this.setLayout(l.id) })),
      { id: "style-filled", group: "View", title: "Map style: filled topics", noHelp: true, run: () => this.setMapStyle("filled") },
      { id: "style-outline", group: "View", title: "Map style: outlined topics", noHelp: true, run: () => this.setMapStyle("outline") },
      { id: "present", group: "View", title: "Present mode", keys: ["Mod+Shift+Enter", "F5"], navOnly: false, run: () => this.presenter.start() },
      { id: "zoom-in", group: "View", title: "Zoom in", keys: ["Mod+="], navOnly: false, run: () => this.mapView.zoomBy(1.2) },
      { id: "zoom-out", group: "View", title: "Zoom out", keys: ["Mod+-"], navOnly: false, run: () => this.mapView.zoomBy(1 / 1.2) },
      { id: "fit", group: "View", title: "Fit map to window", keys: ["Mod+0"], navOnly: false, run: () => this.mapView.fit() },
      { id: "center", group: "View", title: "Center selected topic", keys: ["Mod+J"], run: () => this.sel && this.mapView.center(this.sel) },
      { id: "panel", group: "View", title: "Toggle style panel", keys: ["Mod+Shift+\\"], navOnly: false, run: () => this.togglePanel() },
      { id: "sidebar", group: "View", title: "Toggle sidebar", keys: ["Mod+B", "Mod+\\"], navOnly: false, run: () => ((this.sidebarOpen = !this.sidebarOpen), this.savePrefs(), this.render()) },
      { id: "theme", group: "View", title: "Theme…", keys: ["Mod+Shift+T"], navOnly: false, run: () => this.openThemePicker() },
      { id: "help", group: "View", title: "Keyboard shortcuts", keys: ["?", "F1"], run: () => this.showHelp() },
      // Edit
      { id: "undo", group: "Edit", title: "Undo", keys: ["Mod+Z"], navOnly: true, run: () => this.undo() },
      { id: "redo", group: "Edit", title: "Redo", keys: ["Mod+Shift+Z", "Mod+Y"], navOnly: true, run: () => this.redo() },
      // Maps
      { id: "new", group: "Maps", title: "New map", keys: ["Mod+N"], navOnly: false, run: () => this.newMap() },
      { id: "daily", group: "Maps", title: "Today's daily note", keys: ["Mod+Shift+D"], navOnly: false, run: () => this.openDaily() },
      { id: "search-all", group: "Maps", title: "Search all maps…", keys: ["Mod+Shift+F"], navOnly: false, run: () => this.searchAllMaps() },
      { id: "new-folder", group: "Maps", title: "New folder…", run: () => this.newFolder() },
      { id: "move-map", group: "Maps", title: "Move map to folder…", keys: ["Mod+Shift+M"], navOnly: false, run: () => this.moveToFolder() },
      { id: "switch", group: "Maps", title: "Open map…", keys: ["Mod+P", "Mod+O"], navOnly: false, run: () => this.openSwitcher() },
      { id: "rename", group: "Maps", title: "Rename map", keys: ["Mod+R"], navOnly: false, run: () => this.startEdit(this.root.id, "all") },
      { id: "delete-map", group: "Maps", title: "Move map to Trash", run: () => this.deleteMap() },
      { id: "folder", group: "Maps", title: "Choose maps folder…", run: () => void this.chooseFolder() },
      { id: "check-updates", group: "Maps", title: "Check for updates…", run: () => this.updater.check(false) },
      { id: "save", group: "Maps", title: "Save now", keys: ["Mod+S"], navOnly: false, run: () => ((this.dirty = true), this.save()) },
      { id: "import", group: "Maps", title: "Import XMind / FreeMind / OPML / Markdown / text…", keys: ["Mod+Shift+O"], navOnly: false, run: () => this.importFile() },
      // AI
      ...AI_ACTIONS.map((a) => ({ id: "ai-" + a.id, group: "AI", title: a.title, keys: a.keys ? [a.keys] : undefined, navOnly: false, run: () => this.runAI(a.id) })),
      { id: "ai-settings", group: "AI", title: "AI: settings (provider, model, key)…", run: () => openAISettings(this.store, (m) => this.toast(m)).then(() => this.focusSink()) },
      { id: "export-md", group: "Export", title: "Export Markdown (headings: # ## ###)", run: () => this.exportAs("md") },
      { id: "export-md-list", group: "Export", title: "Export Markdown (nested list)", run: () => this.exportAs("md-list") },
      { id: "export-opml", group: "Export", title: "Export OPML", run: () => this.exportAs("opml") },
      { id: "export-svg", group: "Export", title: "Export SVG image", run: () => this.exportAs("svg") },
      { id: "export-png", group: "Export", title: "Export PNG image", keys: ["Mod+Shift+E"], navOnly: false, run: () => this.exportAs("png") },
      { id: "export-pdf", group: "Export", title: "Export PDF", run: () => this.exportAs("pdf") },
      { id: "export-html", group: "Export", title: "Export web page (HTML)", run: () => this.exportAs("html") },
      { id: "export-json", group: "Export", title: "Export JSON", run: () => this.exportAs("json") },
      { id: "export-txt", group: "Export", title: "Export plain text", run: () => this.exportAs("txt") },
    ];
    this.commands = C;
    for (const c of C) for (const k of c.keys ?? []) {
      if (!this.byChord.has(k)) this.byChord.set(k, []);
      this.byChord.get(k)!.push(c);
    }
  }

  setColor(color: string | undefined) {
    this.styleSelected((x) => {
      if (color) x.color = color;
      else delete x.color;
    });
  }

  /** Apply style changes to the whole branch ("Children too" in the style panel). */
  styleChildren = false;

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

  /** ⌘E: open the notes over the whole right panel; ⌘E again (or Esc) goes back. */
  private toggleNotes() {
    if (this.notesOpen && this.notesFull) return this.closeFullNotes();
    this.openFullNotes();
  }

  openFullNotes() {
    if (this.editing) this.stopEdit();
    this.panelWasClosed = !this.notesOpen;
    this.notesOpen = true;
    this.notesFull = true;
    this.render();
    this.setNotesEditing(true);
  }

  closeFullNotes() {
    const ta = $("notes-text") as HTMLTextAreaElement;
    ta.blur();
    this.notesFull = false;
    this.notesEditing = false;
    if (this.panelWasClosed) this.notesOpen = false;
    this.panelWasClosed = false;
    this.savePrefs();
    this.render();
    this.focusSink();
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

  private openLayoutPicker() {
    const cur = this.layout;
    const items: PaletteItem[] = LAYOUTS.map((l) => ({
      label: l.name + (l.id === cur ? "  ✓" : ""),
      hint: l.id === "mindmap" ? "branches on both sides" : l.id === "down" ? "top to bottom" : l.id === "timeline" ? "main topics down a line" : l.id === "brace" ? "brackets instead of lines" : "one side",
      keys: "",
      run: () => this.setLayout(l.id),
    }));
    this.palette.open(items, "Layout for this map", () => this.focusSink());
  }

  private openThemePicker() {
    const original = this.theme;
    const items: PaletteItem[] = [{ id: "system", name: "System (light/dark)", dark: false }, ...THEMES].map((t: any) => ({
      label: t.name + (t.id === original ? "  ✓" : ""),
      hint: t.id === "system" ? "follows your OS" : t.dark ? "dark" : "light",
      keys: "",
      swatch: t.branches ? t.rootBg : "auto",
      preview: () => {
        this.applyTheme(t.id);
        this.mapView.render();
      },
      run: () => {
        this.theme = t.id;
        this.savePrefs();
        this.applyTheme();
        this.mapView.render();
      },
    }));
    this.palette.open(items, "Theme (↑↓ to preview)", () => this.focusSink(), () => {
      this.applyTheme(original);
      this.mapView.render();
    });
  }

  /** Apply a style change to the selected topic (and its whole branch when "Children too" is on). */
  styleSelected(fn: (n: MapNode) => void) {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    this.mutate(() => {
      if (this.styleChildren) walk(n, fn);
      else fn(n);
    });
  }

  setShape(s: Shape | undefined) {
    this.styleSelected((x) => {
      if (s) x.shape = s;
      else delete x.shape;
    });
  }

  private openShapePicker() {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    const items: PaletteItem[] = [
      { label: "Automatic" + (!n.shape ? "  ✓" : ""), hint: "by level", keys: "", icon: "◌", run: () => this.setShape(undefined) },
      ...SHAPE_LIST.map((sh) => ({
        label: sh.name + (n.shape === sh.id ? "  ✓" : ""),
        hint: "",
        keys: "",
        svg: shapeIcon(sh.id),
        run: () => this.setShape(sh.id),
      })),
    ];
    this.palette.open(items, "Shape", () => this.focusSink());
  }


  /** Icon = an emoji at the start of the topic text (shows up in Obsidian too). */
  private openIconPicker() {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    const lead = n.text.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u);
    const items: PaletteItem[] = ICONS.map(([emoji, name]) => ({
      label: name,
      hint: "",
      keys: "",
      icon: emoji,
      run: () =>
        this.mutate(() => {
          n.text = emoji + " " + (lead ? n.text.slice(lead[0].length) : n.text);
        }),
    }));
    if (lead) items.unshift({ label: "Remove icon", hint: lead[1], keys: "", icon: "✕", run: () => this.mutate(() => void (n.text = n.text.slice(lead[0].length))) });
    this.palette.open(items, "Icon (type to search)", () => this.focusSink());
  }

  /** Cross-link: pick a target topic by name. */
  private linkTo() {
    const from = this.selNode;
    if (!from) return;
    if (this.editing) this.stopEdit();
    const items: PaletteItem[] = [];
    walk(this.root, (n) => {
      if (n === from) return;
      const path = pathTo(this.root, n.id).slice(1, -1).map((x) => x.text.split("\n")[0]).join(" › ");
      items.push({
        label: n.text.split("\n")[0] || "Untitled",
        hint: path,
        keys: "",
        run: () =>
          this.mutate(() => {
            n.anchor ??= newAnchor(this.root);
            from.links = [...new Set([...(from.links ?? []), n.anchor])];
          }),
      });
    });
    this.palette.open(items, `Link “${(from.text.split("\n")[0] || "topic").slice(0, 30)}” to…`, () => this.focusSink());
  }

  /** Jump along a cross-link (outgoing first, then incoming). */
  private goToLink() {
    const n = this.selNode;
    if (!n) return;
    const targets: MapNode[] = [];
    for (const a of n.links ?? []) {
      const t = findByAnchor(this.root, a);
      if (t) targets.push(t);
    }
    if (n.anchor) walk(this.root, (x) => x.links?.includes(n.anchor!) && targets.push(x));
    if (!targets.length) return this.toast("This topic has no links");
    const go = (t: MapNode) => {
      for (const p of pathTo(this.root, t.id).slice(0, -1)) p.collapsed = false;
      if (this.focusId && !isAncestor(this.root, this.focusId, t.id)) this.focusId = null;
      this.sel = t.id;
      this.render();
      this.mapView.center(t.id);
    };
    if (targets.length === 1) return go(targets[0]);
    this.palette.open(
      targets.map((t) => ({ label: t.text.split("\n")[0] || "Untitled", hint: n.links?.includes(t.anchor ?? "-") ? "→ links to" : "← linked from", keys: "", run: () => go(t) })),
      "Go to linked topic",
      () => this.focusSink(),
    );
  }

  private removeLinks() {
    const n = this.selNode;
    if (!n?.links?.length) return this.toast("This topic has no outgoing links");
    const items: PaletteItem[] = n.links.map((a) => {
      const t = findByAnchor(this.root, a);
      return { label: "Remove link to " + (t?.text.split("\n")[0] ?? "(missing topic)"), hint: "", keys: "", run: () => this.mutate(() => void (n.links = n.links!.filter((x) => x !== a))) };
    });
    items.unshift({ label: "Remove all links", hint: "", keys: "", run: () => this.mutate(() => void delete n.links) });
    this.palette.open(items, "Remove links", () => this.focusSink());
  }

  /** Attach files to a topic: copies them into the attachments folder and links them in the notes. */
  async attach(paths?: string[], targetId?: string) {
    const id = targetId ?? this.sel;
    if (!id || !this.store.hasFolder()) return;
    if (this.editing) this.stopEdit();
    await this.flush();
    if (!this.fileName) return this.toast("Save the map first");
    let rels: string[];
    try {
      rels = paths ? await this.store.attachPaths(paths) : await this.store.pickAttachments();
    } catch (err) {
      return this.toast("Attach failed: " + String(err));
    }
    if (!rels.length) return;
    const n = this.node(id);
    if (!n) return;
    const lines = rels.map((r) => {
      const link = relLink(this.fileName!, r).split("/").map(encodeURIComponent).join("/");
      const name = baseOf(r);
      return isImage(r) ? `![${name}](${link})` : `[📎 ${name}](${link})`;
    });
    this.mutate(() => void (n.note = (n.note.trim() ? n.note.trimEnd() + "\n\n" : "") + lines.join("\n")));
    this.sel = id;
    this.notesOpen = true;
    this.notesEditing = false;
    this.savePrefs();
    this.render();
    this.toast(`Attached ${rels.length} file${rels.length > 1 ? "s" : ""}`);
  }

  private openAttachmentPicker() {
    const n = this.selNode;
    const links = n ? noteLinks(n.note) : [];
    if (!links.length || !this.fileName) return this.toast("No attachments on this topic");
    const items: PaletteItem[] = links.map((l) => ({
      label: decodeURIComponent(l.href.split("/").pop() ?? l.href),
      hint: l.image ? "image" : "file",
      keys: "",
      icon: l.image ? "🖼" : "📎",
      run: async () => {
        const rel = resolveLink(this.fileName!, l.href);
        if (rel) await this.store.openFile(rel).catch((e) => this.toast(String(e)));
      },
    }));
    this.palette.open(items, "Open attachment", () => this.focusSink());
  }

  /** Files dropped from Finder / Explorer onto the window attach to the topic under the pointer. */
  private async wireFileDrop() {
    if (this.store.kind !== "desktop") return;
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload as any;
        document.querySelectorAll(".node.drop-file").forEach((x) => x.classList.remove("drop-file"));
        if (p.type === "over" || p.type === "enter") {
          const pos = p.position;
          const el = pos ? document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio)?.closest<HTMLElement>(".node, .o-row") : null;
          el?.classList.add("drop-file");
        } else if (p.type === "drop" && p.paths?.length) {
          const pos = p.position;
          const el = pos ? document.elementFromPoint(pos.x / devicePixelRatio, pos.y / devicePixelRatio)?.closest<HTMLElement>(".node, .o-row") : null;
          void this.attach(p.paths, el?.dataset.id ?? this.sel ?? undefined);
        }
      });
    } catch {
      /* drag and drop not available */
    }
  }

  /** Search the text and notes of every map in the folder. */
  private async searchAllMaps() {
    if (this.editing) this.stopEdit();
    await this.flush();
    this.toast("Searching…");
    const items: PaletteItem[] = [];
    const cache = (this as any)._searchCache ?? ((this as any)._searchCache = new Map<string, { mtime: number; root: MapNode }>());
    for (const m of this.maps) {
      let hit = cache.get(m.name);
      if (!hit || hit.mtime !== m.mtime) {
        try {
          const text = await this.store.read(m.name);
          hit = { mtime: m.mtime, root: parseMarkdown(text, baseOf(m.name).replace(/\.md$/i, "")).root };
          cache.set(m.name, hit);
        } catch {
          continue;
        }
      }
      const mapName = m.name.replace(/\.md$/i, "");
      walk(hit.root, (n) => {
        const path = pathTo(hit!.root, n.id).map((x) => x.text.split("\n")[0]);
        items.push({
          label: n.text.split("\n")[0] || "Untitled",
          hint: mapName + (path.length > 1 ? " › " + path.slice(1, -1).join(" › ") : ""),
          keys: "",
          extra: n.note,
          weak: true,
          run: async () => {
            await this.open(m.name);
            const ip = path.length ? indexPathIn(hit!.root, n.id) : [];
            const target = nodeAtPath(this.root, ip);
            if (target) {
              for (const p of pathTo(this.root, target.id).slice(0, -1)) p.collapsed = false;
              this.sel = target.id;
              this.render();
              this.mapView.center(target.id);
            }
          },
        });
      });
    }
    $("toast").hidden = true;
    this.palette.open(items, `Search ${this.maps.length} maps…`, () => this.focusSink());
  }

  private async newFolder() {
    const name = await this.palette.prompt("New folder name (use / for a sub-folder)");
    if (!name) return this.focusSink();
    const rel = name.replace(/[\\:*?"<>|]/g, "").replace(/^\/+|\/+$/g, "");
    if (!rel) return;
    try {
      await this.store.makeFolder(rel);
      await this.refreshList();
      this.renderSidebar();
      this.toast("Folder created: " + rel);
    } catch (err) {
      this.toast("Could not create folder: " + String(err));
    }
    this.focusSink();
  }

  private async moveToFolder() {
    if (!this.fileName) return;
    await this.flush();
    const cur = dirOf(this.fileName);
    const go = async (dir: string) => {
      const target = this.uniqueName((dir ? dir + "/" : "") + baseOf(this.fileName!), this.fileName!);
      try {
        await this.store.rename(this.fileName!, target);
        this.fileName = target;
        localStorage.setItem("lm:last", target);
        await this.refreshList();
        this.renderSidebar();
        this.toast("Moved to " + (dir || "top level"));
      } catch (err) {
        this.toast("Move failed: " + String(err));
      }
    };
    const items: PaletteItem[] = ["", ...this.folders]
      .filter((f) => f !== cur)
      .map((f) => ({ label: f || "(top level)", hint: "", keys: "", icon: "📁", run: () => go(f) }));
    items.push({
      label: "New folder…",
      hint: "",
      keys: "",
      icon: "＋",
      run: async () => {
        const name = await this.palette.prompt("Folder name");
        if (name) {
          await this.store.makeFolder(name);
          await go(name.replace(/^\/+|\/+$/g, ""));
        }
      },
    });
    this.palette.open(items, "Move map to…", () => this.focusSink());
  }

  /** AI Assist on the selected topic. */
  private async runAI(action: AIAction): Promise<void> {
    const n = this.selNode;
    if (!n) return;
    if (this.editing) this.stopEdit();
    const s = loadAISettings();
    if (!s) {
      this.toast("Set up AI first");
      await openAISettings(this.store, (m) => this.toast(m));
      if (!loadAISettings()) return this.focusSink();
      return this.runAI(action);
    }
    const spec = AI_ACTIONS.find((a) => a.id === action)!;
    if (action === "compare" && n.children.length < 2) return this.toast("Add at least two options as sub-topics first");
    const { system, user } = buildPrompt(action, this.root, n, s.language);
    const el = this.mapView.elementFor(n.id);
    el?.classList.add("busy");
    this.toast("AI is thinking…");
    try {
      const out = (await complete(this.store, s, system, user)).trim();
      if (!out) throw new Error("Empty answer");
      if (spec.result === "children") {
        const nodes = parsePastedText(cleanList(out));
        if (!nodes.length) throw new Error("Could not read the answer as a list");
        this.mutate(() => {
          const live = this.node(n.id);
          if (!live) return null;
          live.collapsed = false;
          live.children.push(...nodes.map(reId));
          return live.id;
        });
        this.toast(`AI added ${nodes.length} topic${nodes.length > 1 ? "s" : ""}`);
      } else {
        const heading = action === "summarize" ? "**Summary**" : "**Comparison**";
        this.mutate(() => {
          const live = this.node(n.id);
          if (live) live.note = (live.note.trim() ? live.note.trimEnd() + "\n\n" : "") + heading + "\n\n" + out;
        });
        this.notesOpen = true;
        this.notesEditing = false;
        this.render();
        this.toast("AI wrote to the notes");
      }
    } catch (err) {
      this.toast("AI failed: " + String((err as Error).message ?? err));
    } finally {
      this.mapView.elementFor(n.id)?.classList.remove("busy");
    }
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
  togglePanel(open = !this.notesOpen) {
    this.notesOpen = open;
    this.savePrefs();
    this.render();
    this.focusSink();
  }

  /** Build the style panel controls once; renderInspector() updates their state. */
  private wireInspector() {
    const colors = $("in-colors");
    const sw = (label: string, css: string, token: string | null, cls = "") =>
      `<button class="sw ${cls}" data-color="${token ?? ""}" title="${label}" style="--sw:${css}"></button>`;
    colors.innerHTML =
      sw("Default", "var(--node-fill)", null, "default") +
      COLOR_NAMES.map((n, i) => sw(n[0].toUpperCase() + n.slice(1) + (i < 9 ? ` (⌥${i + 1})` : ""), cssColor(n), n)).join("") +
      sw("Custom colour…", "transparent", "custom", "custom");
    colors.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.sw");
      if (!b) return;
      const t = b.dataset.color!;
      if (t === "custom") this.customColor();
      else this.setColor(t || undefined);
    });
    const shapes = $("in-shapes");
    shapes.innerHTML = SHAPE_LIST.map((s) => `<button class="shape-btn" data-shape="${s.id}" title="${s.name}"><svg viewBox="0 0 24 18">${shapeIcon(s.id)}</svg></button>`).join("");
    shapes.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.shape-btn");
      if (!b) return;
      const n = this.selNode;
      const s = b.dataset.shape as Shape;
      this.setShape(n?.shape === s ? undefined : s); // click the active shape again = automatic
    });
    ($("in-children") as HTMLInputElement).onchange = (e) => (this.styleChildren = (e.target as HTMLInputElement).checked);
    $("in-icon").onclick = () => this.openIconPicker();
    $("in-theme").onclick = () => this.openThemePicker();
    const lay = $("in-layouts");
    const li: Record<string, string> = { mindmap: "layoutMind", right: "layoutRight", left: "layoutLeft", down: "layoutDown", timeline: "layoutTimeline", brace: "layoutBrace" };
    lay.innerHTML = LAYOUTS.map((l) => `<button data-layout="${l.id}" title="${l.name}">${icon(li[l.id], 20)}</button>`).join("");
    lay.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-layout]");
      if (b) this.setLayout(b.dataset.layout as LayoutKind);
    });
    $("in-lines").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-lines]");
      if (b) this.setLines(b.dataset.lines as LineStyle);
    });
    $("in-mapstyle").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-style]");
      if (b) this.setMapStyle(b.dataset.style as "filled" | "outline");
    });
    this.tasks.wire();
    $("in-actions").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!b) return;
      const act = b.dataset.act!;
      const n = this.selNode;
      if (!n) return;
      if (act === "done") this.mutate(() => void (n.task = n.task === "done" ? undefined : "done"));
      if (act === "checkbox") this.mutate(() => void (n.task = n.task ? undefined : "todo"));
      if (act === "notes") this.openFullNotes();
      if (act === "tasks") {
        this.history.push(this.root, this.sel);
        this.setNote(n.id, (n.note.trim() ? n.note.trimEnd() + "\n" : "") + "- [ ] ");
        this.mapView.updateNode(n.id);
        this.setNotesEditing(true);
      }
      if (act === "attach") void this.attach();
      if (act === "link") this.linkTo();
      if (act === "web") void this.addWebLink();
      if (act === "callout") void this.editCallout();
      if (act === "ai") this.runAI("expand");
      if (act === "labels") void this.tasks.editLabels();
      if (act === "boundary") this.tasks.toggleBoundary();
      if (act === "summary") this.tasks.addSummary([n.id, ...this.extra]);
      if (act === "xref") void (n.xref ? this.tasks.openXref() : this.tasks.linkOtherMap());
      if (act === "link-label") void this.tasks.labelLinks();
    });
  }

  /** Update the style panel for the current selection. */
  renderInspector() {
    // Map section: always reflects the current map, with or without a selection.
    $("in-layout-name").textContent = LAYOUTS.find((x) => x.id === this.layout)?.name ?? "";
    $("in-layouts").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.layout === this.layout));
    $("in-mapstyle").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.style === this.mapStyle));
    $("in-lines").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.lines === this.lines));
    const th = THEMES.find((t) => t.id === this.theme);
    $("in-theme").innerHTML = `<span class="sw-mini" style="background:${th ? th.rootBg : "linear-gradient(135deg,#fff 50%,#1f2937 50%)"}"></span><span>${th ? th.name : "System (light/dark)"}</span><kbd>${prettyChord("Mod+Shift+T")}</kbd>`;
    const n = this.selNode;
    const panel = $("notes");
    panel.classList.toggle("no-sel", !n);
    if (!n) return;
    const l = find(this.root, n.id);
    const depth = l ? l.depth - (this.focusId ? find(this.root, this.focusId)!.depth : 0) : 0;
    $("in-color-name").textContent = n.color ? (n.color.startsWith("#") ? n.color : n.color[0].toUpperCase() + n.color.slice(1)) : "Default";
    $("in-colors").querySelectorAll<HTMLButtonElement>("button.sw").forEach((b) => {
      const t = b.dataset.color!;
      b.classList.toggle("on", t === "custom" ? !!n.color?.startsWith("#") : (t || undefined) === n.color);
      if (t === "custom" && n.color?.startsWith("#")) b.style.setProperty("--sw", n.color);
    });
    const shape = this.mapView.shapeOf(n, depth);
    $("in-shape-name").textContent = (SHAPE_LIST.find((s) => s.id === shape)?.name ?? "") + (n.shape ? "" : " · auto");
    $("in-shapes").querySelectorAll<HTMLButtonElement>("button.shape-btn").forEach((b) => b.classList.toggle("on", b.dataset.shape === shape));
    ($("in-children") as HTMLInputElement).checked = this.styleChildren;
    const lead = n.text.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)/u);
    $("in-icon").innerHTML = lead ? `<span class="emoji">${lead[1]}</span><span>Change icon</span><kbd>${prettyChord("Mod+I")}</kbd>` : `${icon("smile")}<span>Add icon</span><kbd>${prettyChord("Mod+I")}</kbd>`;
    const act = (id: string, ic: string, label: string, keys = "") =>
      `<button class="in-act" data-act="${id}">${icon(ic)}<span>${label}</span>${keys ? `<kbd>${prettyChord(keys)}</kbd>` : ""}</button>`;
    const ts = n.note.match(/^\s*[-*+]\s+\[[ xX]\]/m);
    $("in-actions").innerHTML =
      (n.task
        ? act("done", n.task === "done" ? "check" : "circle", n.task === "done" ? "Mark not done" : "Mark done", "Mod+Enter") + act("checkbox", "x", "Remove checkbox")
        : act("checkbox", "circle", "Add checkbox", "Mod+Enter")) +
      act("notes", "note", n.note.trim() ? "Edit notes" : "Add notes", "Mod+E") +
      act("tasks", "tasks", ts ? "Add task" : "Add tasks") +
      act("attach", "paperclip", "Attach file", "Mod+Shift+A") +
      act("link", "link", "Link to topic…", "Mod+Shift+L") +
      act("web", "globe", "Add web link…") +
      act("callout", "callout", n.callout ? "Edit callout" : "Add callout") +
      act("labels", "tag", n.labels?.length ? "Edit labels" : "Add labels", "Mod+Shift+;") +
      (n === this.root ? "" : act("boundary", "boundary", n.boundary !== undefined ? "Remove boundary" : "Add boundary", "Mod+Shift+B")) +
      (n === this.root || n.summary ? "" : act("summary", "summary", this.extra.size ? `Summary of ${this.extra.size + 1} topics` : "Add summary", "Mod+Shift+]")) +
      (n.links?.length ? act("link-label", "link", "Text on link…") : "") +
      act("xref", "mapLink", n.xref ? "Open linked map" : "Link to other map…") +
      act("ai", "sparkles", "AI: expand topic", "Mod+Shift+I");
    this.tasks.render(n);
  }

  private async addWebLink() {
    const n = this.selNode;
    if (!n) return;
    const url = await this.palette.prompt("Web address (https://…)");
    if (!url) return this.focusSink();
    const href = /^[a-z]+:/i.test(url) ? url : "https://" + url;
    const title = (await this.palette.prompt("Link text (optional)", "")) || href.replace(/^https?:\/\//, "");
    this.history.push(this.root, this.sel);
    this.setNote(n.id, (n.note.trim() ? n.note.trimEnd() + "\n\n" : "") + `[🔗 ${title}](${href})`);
    this.notesEditing = false;
    this.render();
    this.focusSink();
  }

  private async editCallout() {
    const n = this.selNode;
    if (!n) return;
    const v = await this.palette.prompt("Callout text (empty to remove)", n.callout ?? "");
    if (v === null) return this.focusSink();
    this.mutate(() => {
      if (v.trim()) n.callout = v.trim();
      else delete n.callout;
    });
    this.focusSink();
  }

  private wireChrome() {
    $("sb-folder").onclick = () => void (this.store.kind === "desktop" ? this.chooseFolder() : this.toast("The desktop app saves to a folder of .md files."));
    // Fill icon placeholders.
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon!));
    });
    $("sb-new").onclick = () => void this.newMap();
    $("sb-new-menu").onclick = (e) =>
      showMenu(e.currentTarget as HTMLElement, [
        { label: "New map", keys: prettyChord("Mod+N"), icon: icon("map"), run: () => this.newMap() },
        { label: "Today's daily note", keys: prettyChord("Mod+Shift+D"), icon: icon("note"), run: () => this.openDaily() },
        { label: "New folder…", icon: icon("folder"), run: () => this.newFolder() },
        { label: "Import XMind, FreeMind, OPML, Markdown…", keys: prettyChord("Mod+Shift+O"), icon: icon("export"), run: () => this.importFile(), sep: true },
      ], () => this.focusSink());
    $("sb-search").onclick = () => void this.searchAllMaps();
    $("sb-collapse").onclick = () => this.commands.find((c) => c.id === "sidebar")!.run();
    $("sb-settings").onclick = async (e) => {
      const anchor = e.currentTarget as HTMLElement;
      const version = await appVersion();
      showMenu(anchor, [
        { label: "Theme…", keys: prettyChord("Mod+Shift+T"), icon: icon("palette"), run: () => this.openThemePicker() },
        { label: "AI Assist settings…", icon: icon("sparkles"), run: () => openAISettings(this.store, (m) => this.toast(m)).then(() => this.focusSink()) },
        { label: "Choose maps folder…", icon: icon("folder"), run: () => this.chooseFolder() },
        { label: "Check for updates…", icon: icon("download"), run: () => this.updater.check(false), sep: true },
        {
          label: `Check automatically: ${autoCheckEnabled() ? "on" : "off"}`,
          icon: icon("refresh"),
          run: () => {
            setAutoCheck(!autoCheckEnabled());
            this.toast(`Automatic update checks ${autoCheckEnabled() ? "on" : "off"}`);
          },
        },
        { label: `About Ramify ${version}`, icon: icon("info"), run: () => openExternal(RELEASES_URL) },
        { label: "Keyboard shortcuts", keys: "?", icon: icon("help"), run: () => this.showHelp(), sep: true },
      ], () => this.focusSink());
    };
    $("map-title").onclick = () => this.openSwitcher();
    $("tb-outline").onclick = () => this.setView(this.view === "outline" ? "map" : "outline");
    $("tb-gantt").onclick = () => this.setView(this.view === "gantt" ? "map" : "gantt");
    $("tb-search").onclick = () => this.openSearch();
    $("tb-present").onclick = () => void this.presenter.start();
    $("tb-panel").onclick = () => this.togglePanel();
    $("tb-export").onclick = (e) =>
      showMenu(e.currentTarget as HTMLElement, [
        { label: "PNG image", keys: prettyChord("Mod+Shift+E"), run: () => this.exportAs("png") },
        { label: "PDF", run: () => this.exportAs("pdf") },
        { label: "SVG image", run: () => this.exportAs("svg") },
        { label: "Markdown (headings)", run: () => this.exportAs("md"), sep: true },
        { label: "Markdown (nested list)", run: () => this.exportAs("md-list") },
        { label: "Web page (HTML)", run: () => this.exportAs("html") },
        { label: "OPML", run: () => this.exportAs("opml"), sep: true },
        { label: "JSON", run: () => this.exportAs("json") },
        { label: "Plain text", run: () => this.exportAs("txt") },
      ], () => this.focusSink(), "right");
    $("help-fab").onclick = () => this.showHelp();
    $("zb-in").onclick = () => this.mapView.zoomBy(1.2);
    $("zb-out").onclick = () => this.mapView.zoomBy(1 / 1.2);
    $("zb-pct").onclick = () => this.mapView.zoomBy(1 / this.mapView.cam.s);
    $("zb-fit").onclick = () => this.mapView.fit();
    $("zb-center").onclick = () => this.sel && this.mapView.center(this.sel);
    $("zb-undo").onclick = () => this.undo();
    $("zb-redo").onclick = () => this.redo();
    // Buttons never keep keyboard focus: the map keeps it.
    document.querySelectorAll<HTMLButtonElement>("#topbar button, #zoombar button, #notes .in-sec button, #help-fab, #sb-collapse, .sb-new button").forEach((b) =>
      b.addEventListener("mouseup", () => setTimeout(() => {
        if (!document.querySelector(".menu, .modal") && !this.palette.isOpen() && document.activeElement !== $("notes-text")) this.focusSink();
      }, 0)),
    );
    this.wireInspector();
    $("sb-help").onclick = () => this.showHelp();
    $("palette-btn").onclick = () => this.openCommands();
    ($("sb-filter") as HTMLInputElement).oninput = () => this.renderSidebar();
    document.querySelectorAll<HTMLButtonElement>("#view-seg button").forEach((b) => (b.onclick = () => this.setView(b.dataset.view as View)));
    $("notes-close").onclick = () => {
      this.notesFull = false;
      this.togglePanel(false);
    };
    $("notes-back").onclick = () => {
      this.panelWasClosed = false; // "back" returns to the style panel, it doesn't close it
      this.closeFullNotes();
    };
    $("notes-mode").onclick = () => this.setNotesEditing(!this.notesEditing);
    $("notes-attach").onclick = () => void this.attach();
    // Clicking the rendered notes (not a link or checkbox) switches to editing.
    $("notes-preview").addEventListener("dblclick", () => this.setNotesEditing(true));
    const ta = $("notes-text") as HTMLTextAreaElement;
    let pushed = false;
    ta.addEventListener("focus", () => {
      pushed = false;
      this.notesEditing = true;
    });
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
    attachListEditing(ta);
    // Click on empty stage returns keyboard focus to the map.
    $("stage").addEventListener("mousedown", (e) => {
      if (e.target === $("stage")) this.focusSink();
    });
  }
}

// ---------------------------------------------------------------- helpers

function indexPathIn(root: MapNode, id: string): number[] {
  return indexPath(root, id);
}

/** Layout stored in front matter as "ramify-layout: down". */
function layoutFrom(frontmatter: string): LayoutKind | null {
  const m = frontmatter.match(/^ramify-layout:\s*(\w+)\s*$/m);
  return m && LAYOUTS.some((l) => l.id === m[1]) ? (m[1] as LayoutKind) : null;
}

/** Set a key in YAML front matter (creating it if needed). */
function setFrontmatter(fm: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  if (!fm) return `---\n${line}\n---\n`;
  const re = new RegExp(`^${key}:.*$`, "m");
  if (re.test(fm)) return fm.replace(re, line);
  return fm.replace(/\n---\s*\n?$/, `\n${line}\n---\n`);
}

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
    `# Welcome to Ramify ^welcome
> Type to rename a topic. Press ? for every shortcut, ⌘K for every command.

- Make topics
  - Tab → child topic
  - Enter → next topic
  - Just start typing to replace text
- While typing <!--shape:pill-->
  - Enter → next topic
  - Tab / Shift+Tab → indent / outdent
  - Enter on an empty topic → step out
  - Esc → stop typing
- 🎨 Style it <!--color:purple-->
  - ⌥1–⌥9 colour, ⌘⇧C any colour
  - ⌘⇧S shape, ⌘I icon
  - ⌘⇧T theme (16 themes), ⌘L layout
- Move around
  - Arrow keys
  - ⌘F find, ⌘⇧F search all maps
  - ⌘] focus a branch, ⌘⇧↩ present
- [ ] Try the notes on this topic ^try
  > ⌘E opens notes. They are **Markdown**:
  >
  > - [x] checklists
  > - [ ] drop a file on a topic to attach it
  > - [ ] ⌘⇧L links two topics
- 🤖 AI Assist <!--link:try-->
  - ⌘⇧I expands a topic
  - ⌘K → "AI: settings" to connect Claude, OpenAI or a local model
- Your files
  > Every map is a plain Markdown file.
  > Open it in Obsidian, edit it, and the map updates.
  - ⌘2 outline view
  - ⌘⇧D daily note
`,
  ).root;
}
