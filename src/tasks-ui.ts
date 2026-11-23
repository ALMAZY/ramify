// Style panel "Task" section, plus the commands for labels, boundaries,
// summaries, predecessors and links to topics in other maps.

import type { App } from "./app";
import { MapNode, Plan, find, findByAnchor, makeNode, newAnchor, pathTo, walk, isAncestor } from "./model";
import { addDays, parseDay, progressOf, reschedule, span, spanDays, tidyPlan, todayStr, shortDate } from "./plan";
import { icon } from "./ui-icons";
import { prettyChord } from "./keys";
import type { PaletteItem } from "./palette";
import { parseMarkdown, serializeMarkdown } from "./markdown";

const $ = (id: string) => document.getElementById(id)!;
const inp = (id: string) => $(id) as HTMLInputElement;

export class TaskUI {
  constructor(private app: App) {}

  wire() {
    $("t-priority").innerHTML =
      `<button data-p="" title="No priority">–</button>` + [1, 2, 3, 4, 5].map((p) => `<button data-p="${p}" class="p${p}">P${p}</button>`).join("");
    $("t-add").innerHTML = `${icon("calendar")}<span>Add task details</span><kbd>${prettyChord("Mod+Shift+K")}</kbd>`;
    $("t-add").onclick = () => this.addPlan();
    $("t-clear").onclick = () => this.update(() => undefined, true);
    $("t-priority").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
      if (b) this.update((p) => ({ ...p, priority: b.dataset.p ? Number(b.dataset.p) : undefined }));
    });
    const range = inp("t-progress");
    range.addEventListener("input", () => ($("t-progress-val").textContent = range.value + "%"));
    range.addEventListener("change", () => this.update((p) => ({ ...p, progress: Number(range.value) })));
    $("t-auto").onclick = () => this.update((p) => ({ ...p, progress: undefined }));
    inp("t-start").addEventListener("change", () =>
      this.update((p) => {
        const v = inp("t-start").value || undefined;
        // Keep the length when moving the start.
        const s = span(p);
        if (v && p.start && p.due) return { ...p, start: v, due: addDays(v, (s.days ?? 1) - 1) };
        return { ...p, start: v };
      }),
    );
    inp("t-due").addEventListener("change", () => this.update((p) => ({ ...p, due: inp("t-due").value || undefined })));
    inp("t-days").addEventListener("change", () =>
      this.update((p) => {
        const d = Math.max(1, Math.round(Number(inp("t-days").value) || 1));
        const start = p.start ?? p.due ?? todayStr();
        return { ...p, start, due: addDays(start, d - 1) };
      }),
    );
    inp("t-who").addEventListener("change", () => this.update((p) => ({ ...p, who: inp("t-who").value })));
    for (const id of ["t-start", "t-due", "t-days", "t-who"])
      inp(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
          this.app.focusSink();
        }
      });
    $("t-after").addEventListener("click", (e) => {
      const el = e.target as HTMLElement;
      const rm = el.closest<HTMLElement>("[data-rm]");
      if (rm) return this.update((p) => ({ ...p, after: (p.after ?? []).filter((a) => a !== rm.dataset.rm) }));
      if (el.closest("#t-after-add")) this.pickPredecessor();
    });
  }

  render(n: MapNode | null) {
    const sec = $("in-task");
    if (!n) return;
    const has = !!n.plan;
    $("t-add").hidden = has;
    $("t-fields").hidden = !has;
    $("t-clear").hidden = !has;
    if (!has) return;
    const p = n.plan!;
    const prog = progressOf(n);
    const range = inp("t-progress");
    if (document.activeElement !== range) range.value = String(prog ?? 0);
    $("t-progress-val").textContent = prog === undefined ? "–" : prog + "%";
    $("t-auto").classList.toggle("on", p.progress === undefined);
    $("t-priority").querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", (b.dataset.p || undefined) === (p.priority ? String(p.priority) : undefined)));
    const s = span(p);
    const set = (id: string, v: string) => {
      if (document.activeElement !== $(id)) inp(id).value = v;
    };
    set("t-start", p.start ?? "");
    set("t-due", p.due ?? "");
    set("t-days", s.days ? String(s.days) : "");
    set("t-who", p.who ?? "");
    const chips = (p.after ?? [])
      .map((a) => {
        const t = findByAnchor(this.app.root, a);
        return t ? `<span class="t-chip" title="${esc(t.text)}">${esc(oneLine(t.text).slice(0, 28))}<button data-rm="${a}" title="Remove">×</button></span>` : "";
      })
      .join("");
    $("t-after").innerHTML = chips + `<button id="t-after-add" class="mini-btn">+ Add</button>`;
    sec.dataset.state = "on";
  }

  /** Change the selected topic's plan; `fn` returns the new plan (undefined removes it). */
  update(fn: (p: Plan) => Plan | undefined, remove = false) {
    const n = this.app.selNode;
    if (!n) return;
    this.app.mutate(() => {
      const next = remove ? undefined : fn({ ...(n.plan ?? {}) });
      const tidy = next ? tidyPlan(next) : undefined;
      // Keep an empty plan while the section is open so the fields stay visible.
      n.plan = tidy ?? (remove ? undefined : {});
      reschedule(this.app.root);
    });
  }

  /** Give the selected topic task details: starts today, one day long. */
  addPlan() {
    const n = this.app.selNode;
    if (!n) return;
    if (!this.app.notesOpen) this.app.togglePanel(true);
    if (!n.plan) {
      const t = todayStr();
      this.app.mutate(() => void (n.plan = { start: t, due: t }));
    }
    requestAnimationFrame(() => {
      $("in-task").scrollIntoView({ block: "nearest" });
      inp("t-start").focus();
    });
  }

  /** Pick a topic this one has to wait for. */
  pickPredecessor(targetId?: string) {
    const from = targetId ? find(this.app.root, targetId)?.node : this.app.selNode;
    if (!from) return;
    const items: PaletteItem[] = [];
    walk(this.app.root, (n) => {
      if (n === from || isAncestor(this.app.root, from.id, n.id) || isAncestor(this.app.root, n.id, from.id)) return;
      if (n.anchor && from.plan?.after?.includes(n.anchor)) return;
      const s = span(n.plan);
      items.push({
        label: oneLine(n.text) || "Untitled",
        hint: s.start ? `${shortDate(s.start)} – ${shortDate(s.due!)}` : crumb(this.app.root, n),
        keys: "",
        run: () =>
          this.app.mutate(() => {
            n.anchor ??= newAnchor(this.app.root);
            if (!n.plan) {
              const t = todayStr();
              n.plan = { start: t, due: t };
            }
            from.plan = { ...(from.plan ?? {}), after: [...(from.plan?.after ?? []), n.anchor] };
            if (!from.plan.start) {
              const ps = span(n.plan);
              const d = span(from.plan).days ?? 1;
              from.plan.start = addDays(ps.due!, 1);
              from.plan.due = addDays(from.plan.start, d - 1);
            }
            reschedule(this.app.root);
          }),
      });
    });
    this.app.palette.open(items, `“${oneLine(from.text).slice(0, 30)}” starts after…`, () => this.app.focusSink());
  }

  /** Chain topics so each starts after the previous one (Gantt "Dependencies"). */
  chain(ids: string[]) {
    if (ids.length < 2) return this.app.toast("Select two or more tasks (Shift-click) to chain them");
    this.app.mutate(() => {
      const nodes = ids.map((id) => find(this.app.root, id)?.node).filter((x): x is MapNode => !!x);
      const first = nodes[0];
      if (!span(first.plan).start) {
        const t = todayStr();
        first.plan = { ...(first.plan ?? {}), start: t, due: t };
      }
      for (let i = 1; i < nodes.length; i++) {
        const prev = nodes[i - 1],
          cur = nodes[i];
        prev.anchor ??= newAnchor(this.app.root);
        const days = span(cur.plan).days ?? 1;
        const start = addDays(span(prev.plan).due!, 1);
        cur.plan = { ...(cur.plan ?? {}), after: [...new Set([...(cur.plan?.after ?? []), prev.anchor])], start, due: addDays(start, days - 1) };
      }
      reschedule(this.app.root);
    });
    this.app.toast(`Chained ${ids.length} tasks`);
  }

  async editLabels() {
    const n = this.app.selNode;
    if (!n) return;
    const v = await this.app.palette.prompt("Labels, separated by commas (empty to remove)", (n.labels ?? []).join(", "));
    if (v === null) return this.app.focusSink();
    const ls = v
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    this.app.mutate(() => void (n.labels = ls.length ? [...new Set(ls)] : undefined));
    this.app.focusSink();
  }

  async editBoundary() {
    const n = this.app.selNode;
    if (!n) return;
    if (n === this.app.root) return this.app.toast("The central topic can't have a boundary");
    const v = await this.app.palette.prompt(n.boundary !== undefined ? "Boundary label (empty = no label; Remove with ⌘⇧B again)" : "Boundary label (optional)", n.boundary ?? "");
    if (v === null) return this.app.focusSink();
    this.app.mutate(() => void (n.boundary = v.trim()));
    this.app.focusSink();
  }

  toggleBoundary() {
    const n = this.app.selNode;
    if (!n || n === this.app.root) return;
    if (n.boundary !== undefined) this.app.mutate(() => void delete n.boundary);
    else void this.editBoundary();
  }

  /**
   * Summary for the selected topic and the siblings selected with Shift
   * (or just the selected one): adds a summary topic after them, drawn with a brace.
   */
  addSummary(ids: string[]) {
    const sel = this.app.selNode;
    if (!sel) return;
    const l = find(this.app.root, sel.id);
    if (!l?.parent) return this.app.toast("The central topic can't be summarised");
    const parent = l.parent;
    const idx = [...new Set(ids.length ? ids : [sel.id])]
      .map((id) => parent.children.findIndex((c) => c.id === id))
      .filter((i) => i >= 0 && !parent.children[i].summary)
      .sort((a, b) => a - b);
    if (!idx.length) return;
    const from = idx[0],
      to = idx[idx.length - 1];
    const id = this.app.mutate(() => {
      const s = makeNode("Summary");
      s.summary = to - from + 1;
      parent.children.splice(to + 1, 0, s);
      return s.id;
    });
    if (typeof id === "string") this.app.startEdit(id, "all");
  }

  /** Link the selected topic to a topic in another map (opens there when clicked). */
  async linkOtherMap() {
    const from = this.app.selNode;
    if (!from) return;
    const maps = this.app.maps.filter((m) => m.name !== this.app.fileName);
    if (!maps.length) return this.app.toast("There are no other maps yet");
    const name = await new Promise<string | null>((res) => {
      this.app.palette.open(
        maps.map((m) => ({ label: m.name.replace(/\.md$/, "").split("/").pop()!, hint: m.name.includes("/") ? m.name.slice(0, m.name.lastIndexOf("/")) : "", keys: "", run: () => res(m.name) })),
        "Link to a topic in which map?",
        () => res(null),
      );
    });
    if (!name) return this.app.focusSink();
    const text = await this.app.store.read(name);
    const doc = parseMarkdown(text, name.replace(/\.md$/, ""));
    const picked = await new Promise<MapNode | null>((res) => {
      const items: PaletteItem[] = [];
      walk(doc.root, (n) => items.push({ label: oneLine(n.text) || "Untitled", hint: crumb(doc.root, n), keys: "", run: () => res(n) }));
      this.app.palette.open(items, "Link to which topic?", () => res(null));
    });
    if (!picked) return this.app.focusSink();
    if (!picked.anchor) {
      picked.anchor = newAnchor(doc.root);
      await this.app.store.write(name, serializeMarkdown(doc.root, doc.frontmatter));
    }
    this.app.mutate(() => void (from.xref = `${name}#${picked.anchor}`));
    this.app.toast(`Linked to “${oneLine(picked.text).slice(0, 40)}”`);
    this.app.focusSink();
  }

  /** Follow the selected topic's link to another map. */
  async openXref(n: MapNode | null = this.app.selNode) {
    if (!n?.xref) return;
    const [name, anchor] = n.xref.split("#");
    if (!this.app.maps.some((m) => m.name === name)) return this.app.toast(`Map not found: ${name}`);
    await this.app.open(name);
    const t = findByAnchor(this.app.root, anchor);
    if (!t) return this.app.toast("That topic is no longer in the map");
    for (const p of pathTo(this.app.root, t.id).slice(0, -1)) p.collapsed = false;
    this.app.sel = t.id;
    this.app.render();
    this.app.mapView.center(t.id);
  }

  /** Edit the text on the cross-links leaving the selected topic. */
  async labelLinks() {
    const n = this.app.selNode;
    if (!n?.links?.length) return this.app.toast("This topic has no outgoing links (⌘⇧L adds one)");
    let target = n.links[0];
    if (n.links.length > 1) {
      const picked = await new Promise<string | null>((res) =>
        this.app.palette.open(
          n.links!.map((a) => ({ label: oneLine(findByAnchor(this.app.root, a)?.text ?? a), hint: n.linkLabels?.[a] ?? "", keys: "", run: () => res(a) })),
          "Label which link?",
          () => res(null),
        ),
      );
      if (!picked) return this.app.focusSink();
      target = picked;
    }
    const v = await this.app.palette.prompt("Text on the link (empty to remove)", n.linkLabels?.[target] ?? "");
    if (v === null) return this.app.focusSink();
    this.app.mutate(() => {
      const ls = { ...(n.linkLabels ?? {}) };
      if (v.trim()) ls[target] = v.trim();
      else delete ls[target];
      n.linkLabels = Object.keys(ls).length ? ls : undefined;
    });
    this.app.focusSink();
  }
}

/** Duration in days between two ISO dates, inclusive (for display). */
export function daysLabel(start: string, due: string): string {
  const d = spanDays(start, due);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function overdue(n: MapNode): boolean {
  const s = span(n.plan);
  return !!s.due && parseDay(s.due) < parseDay(todayStr()) && (progressOf(n) ?? 0) < 100;
}

function oneLine(t: string) {
  return t.split("\n")[0];
}
function crumb(root: MapNode, n: MapNode) {
  return pathTo(root, n.id)
    .slice(1, -1)
    .map((x) => oneLine(x.text))
    .join(" › ");
}
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
