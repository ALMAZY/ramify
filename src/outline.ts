import type { App } from "./app";
import { MapNode, visibleOrder, cycleTask } from "./model";
import { placeCaret, caretEdges } from "./mapview";
import { resolveColors, cssColor } from "./colors";

/** The same map as an indented list. Built for typing fast during a lecture. */
export class OutlineView {
  private rows = new Map<string, HTMLElement>();
  constructor(private app: App, private host: HTMLElement) {
    host.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLElement>(".o-row");
      if (!row) return;
      const id = row.dataset.id!;
      const n = this.app.node(id);
      if (!n) return;
      if (t.classList.contains("o-bullet")) {
        e.preventDefault();
        if (n.children.length && n !== this.app.top) this.app.mutate(() => void (n.collapsed = !n.collapsed));
        return;
      }
      if (t.classList.contains("o-box")) {
        e.preventDefault();
        this.app.mutate(() => void (n.task === "todo" ? (n.task = "done") : n.task === "done" ? (n.task = "todo") : cycleTask(n)));
        return;
      }
      if (this.app.editing !== id) {
        e.preventDefault();
        this.app.startEdit(id, "end");
      }
    });
  }

  render() {
    const editing = this.app.editing;
    let caretOffset: number | null = null;
    if (editing) {
      const txt = this.rows.get(editing)?.querySelector<HTMLElement>(".o-txt");
      if (txt && document.activeElement === txt) caretOffset = caretPos(txt);
    }
    this.host.innerHTML = "";
    this.rows.clear();
    const top = this.app.top;
    const depth = new Map<string, number>();
    const color = resolveColors(this.app.root);
    const rec = (n: MapNode, d: number) => {
      depth.set(n.id, d);
      if (!n.collapsed) n.children.forEach((k) => rec(k, d + 1));
    };
    rec(top, 0);
    const list = document.createElement("div");
    list.className = "o-list";
    for (const n of visibleOrder(top)) {
      const d = depth.get(n.id)!;
      const row = document.createElement("div");
      row.className = "o-row" + (d === 0 ? " o-title" : "");
      row.dataset.id = n.id;
      row.style.setProperty("--d", String(Math.max(0, d - 1)));
      const c = color.get(n.id);
      if (c && d > 0) row.style.setProperty("--c", cssColor(c));
      row.classList.toggle("todo", n.task === "todo");
      row.classList.toggle("done", n.task === "done");
      const bullet = document.createElement("span");
      bullet.className = "o-bullet" + (n.collapsed && n.children.length ? " folded" : "") + (n.children.length ? " parent" : "");
      const box = document.createElement("span");
      box.className = "o-box";
      const txt = document.createElement("span");
      txt.className = "o-txt";
      txt.textContent = n.text;
      if (d > 0) row.append(bullet);
      row.append(box, txt);
      if (n.note.trim()) {
        const note = document.createElement("div");
        note.className = "o-note";
        note.textContent = notePreview(n.note);
        row.append(note);
      }
      list.append(row);
      this.rows.set(n.id, row);
    }
    this.host.append(list);
    this.renderSelection();
    if (editing && this.rows.has(editing)) this.focusRow(editing, caretOffset ?? "end");
  }

  renderSelection() {
    for (const [id, row] of this.rows) row.classList.toggle("sel", id === this.app.sel);
    const r = this.app.sel ? this.rows.get(this.app.sel) : null;
    r?.scrollIntoView({ block: "nearest" });
  }

  endEdit(id: string) {
    const txt = this.rows.get(id)?.querySelector<HTMLElement>(".o-txt");
    if (!txt) return;
    (txt as any)._cleanup?.();
    txt.removeAttribute("contenteditable");
  }

  focusRow(id: string, caret: "start" | "end" | "all" | number) {
    const row = this.rows.get(id);
    if (!row) return;
    const txt = row.querySelector<HTMLElement>(".o-txt")!;
    if (txt.isContentEditable && document.activeElement === txt) {
      if (typeof caret === "number") setCaret(txt, caret);
      return;
    }
    if (txt.isContentEditable) (txt as any)._cleanup?.();
    // Close any other open row editor.
    this.host.querySelectorAll<HTMLElement>(".o-txt[contenteditable]").forEach((x) => {
      (x as any)._cleanup?.();
      x.removeAttribute("contenteditable");
    });
    try {
      txt.contentEditable = "plaintext-only";
    } catch {
      txt.contentEditable = "true";
    }
    if (txt.contentEditable !== "plaintext-only") txt.contentEditable = "true";
    txt.focus({ preventScroll: true });
    if (typeof caret === "number") setCaret(txt, caret);
    else placeCaret(txt, caret);
    row.scrollIntoView({ block: "nearest" });

    const onInput = () => this.app.setText(id, txt.innerText.replace(/\n$/, ""));
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) return;
      const { atStart, atEnd } = caretEdges(txt);
      this.app.editKey(e, id, atStart, atEnd);
    };
    const onBlur = () =>
      setTimeout(() => {
        // A re-render replaces the row element; that blur is not the user leaving the topic.
        if (!txt.isConnected) return;
        if (this.app.editing === id && document.activeElement !== txt && this.app.view === "outline") this.app.stopEdit();
      }, 0);
    const onPaste = (e: ClipboardEvent) => {
      const t = e.clipboardData?.getData("text/plain") ?? "";
      if (t.includes("\n")) {
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
}

function caretPos(el: HTMLElement): number {
  const s = window.getSelection();
  if (!s || !s.rangeCount) return 0;
  const r = s.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function setCaret(el: HTMLElement, offset: number) {
  const t = el.firstChild;
  const r = document.createRange();
  if (!t) {
    r.selectNodeContents(el);
    r.collapse(true);
  } else {
    r.setStart(t, Math.min(offset, t.textContent?.length ?? 0));
    r.collapse(true);
  }
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

/** First lines of a note as plain text (Markdown marks removed). */
function notePreview(md: string): string {
  return md
    .split("\n")
    .map((l) =>
      l
        .replace(/^\s*\|?[-:| ]+\|?\s*$/, "") // table rule
        .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, (m) => (/x/i.test(m) ? "☑ " : "☐ "))
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/^#+\s+/, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__|\*|_|`|~~)/g, "")
        .replace(/\|/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
}
