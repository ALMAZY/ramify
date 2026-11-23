// Markdown <-> tree. The file format is a plain, Obsidian-friendly outline:
//
//   # Map title            <- root topic
//   > root note            <- notes are blockquotes under their topic
//
//   - Topic
//     > note line
//     - [ ] task topic
//     - folded topic <!--collapsed-->
//       - child
//
// Import also accepts ## / ### headings, *, +, 1. bullets, tabs, and plain
// continuation lines, so most Markdown notes open as a sensible map.

import { MapNode, makeNode, Plan, Shape, SHAPES } from "./model";
import { SHAPE_ALIASES } from "./shapes";
import { isValidColor } from "./colors";

export interface ParsedDoc {
  root: MapNode;
  frontmatter: string; // raw, including the --- fences, or ""
}

const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const COLLAPSED = "<!--collapsed-->";

function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === "\t" ? 4 : 1;
  return w;
}

const COLOR_RE = /<!--\s*color:\s*([#\w]+)\s*-->/i;

const SHAPE_RE = /<!--\s*shape:\s*(\w+)\s*-->/i;
const CALLOUT_RE = /<!--\s*callout:\s*([\s\S]*?)\s*-->/i;
const LINK_RE = /<!--\s*link:\s*([\w-]+)(?:\s*:\s*([\s\S]*?))?\s*-->/gi;
const PLAN_RE = /<!--\s*plan:\s*([\s\S]*?)\s*-->/i;
const LABELS_RE = /<!--\s*labels:\s*([\s\S]*?)\s*-->/i;
const BOUNDARY_RE = /<!--\s*boundary(?:\s*:\s*([\s\S]*?))?\s*-->/i;
const SUMMARY_RE = /<!--\s*summary:\s*(\d+)\s*-->/i;
const XREF_RE = /<!--\s*xref:\s*([\s\S]*?)\s*-->/i;
const ANCHOR_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

interface Meta {
  collapsed?: boolean;
  color?: string;
  shape?: Shape;
  anchor?: string;
  links?: string[];
  linkLabels?: Record<string, string>;
  callout?: string;
  plan?: Plan;
  labels?: string[];
  boundary?: string;
  summary?: number;
  xref?: string;
}

function applyMeta(n: MapNode, m: Meta) {
  if (m.collapsed) n.collapsed = true;
  if (m.color) n.color = m.color;
  if (m.shape) n.shape = m.shape;
  if (m.anchor) n.anchor = m.anchor;
  if (m.links?.length) n.links = m.links;
  if (m.linkLabels) n.linkLabels = m.linkLabels;
  if (m.callout) n.callout = m.callout;
  if (m.plan) n.plan = m.plan;
  if (m.labels?.length) n.labels = m.labels;
  if (m.boundary !== undefined) n.boundary = m.boundary;
  if (m.summary) n.summary = m.summary;
  if (m.xref) n.xref = m.xref;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "progress=40;priority=2;start=2026-09-20;due=2026-11-18;who=Ann;after=a1,b2" */
export function parsePlan(s: string): Plan | undefined {
  const p: Plan = {};
  for (const part of s.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (!v) continue;
    if (k === "progress" && /^\d+$/.test(v)) p.progress = Math.max(0, Math.min(100, Number(v)));
    else if (k === "priority" && /^[1-5]$/.test(v)) p.priority = Number(v);
    else if (k === "start" && DATE_RE.test(v)) p.start = v;
    else if (k === "due" && DATE_RE.test(v)) p.due = v;
    else if (k === "who") p.who = v;
    else if (k === "after") {
      const a = v.split(",").map((x) => x.trim()).filter((x) => /^[\w-]+$/.test(x));
      if (a.length) p.after = a;
    }
  }
  return Object.keys(p).length ? p : undefined;
}

export function planToString(p: Plan): string {
  const out: string[] = [];
  if (p.progress !== undefined) out.push(`progress=${p.progress}`);
  if (p.priority) out.push(`priority=${p.priority}`);
  if (p.start) out.push(`start=${p.start}`);
  if (p.due) out.push(`due=${p.due}`);
  if (p.who) out.push(`who=${markerText(p.who).replace(/[;=]/g, ",")}`);
  if (p.after?.length) out.push(`after=${p.after.join(",")}`);
  return out.join(";");
}

/** Text that is safe inside an HTML comment marker. */
function markerText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/--+>?/g, "—").trim();
}

function cleanText(raw: string): { text: string; collapsed: boolean; color?: string; shape?: Shape; anchor?: string; links?: string[]; callout?: string } & Meta {
  let t = raw;
  let callout: string | undefined;
  const co = t.match(CALLOUT_RE);
  if (co) {
    callout = co[1].trim() || undefined;
    t = t.replace(CALLOUT_RE, "");
  }
  const extra: Meta = {};
  const pm = t.match(PLAN_RE);
  if (pm) {
    extra.plan = parsePlan(pm[1]);
    t = t.replace(PLAN_RE, "");
  }
  const lm = t.match(LABELS_RE);
  if (lm) {
    const ls = lm[1].split("|").map((x) => x.trim()).filter(Boolean);
    if (ls.length) extra.labels = ls;
    t = t.replace(LABELS_RE, "");
  }
  const bm = t.match(BOUNDARY_RE);
  if (bm) {
    extra.boundary = (bm[1] ?? "").trim();
    t = t.replace(BOUNDARY_RE, "");
  }
  const sm2 = t.match(SUMMARY_RE);
  if (sm2) {
    const k = Number(sm2[1]);
    if (k > 0) extra.summary = k;
    t = t.replace(SUMMARY_RE, "");
  }
  const xm = t.match(XREF_RE);
  if (xm) {
    if (xm[1].includes("#")) extra.xref = xm[1].trim();
    t = t.replace(XREF_RE, "");
  }
  let collapsed = false;
  let color: string | undefined;
  let shape: Shape | undefined;
  let anchor: string | undefined;
  const links: string[] = [];
  t = t.replace(LINK_RE, (_m, a: string, label?: string) => {
    links.push(a);
    if (label?.trim()) (extra.linkLabels ??= {})[a] = label.trim();
    return "";
  });
  const sm = t.match(SHAPE_RE);
  if (sm) {
    t = t.replace(SHAPE_RE, "");
    const raw = sm[1].toLowerCase();
    const s = (SHAPE_ALIASES[raw] ?? raw) as Shape;
    if (SHAPES.includes(s)) shape = s;
  }
  if (t.includes(COLLAPSED)) {
    collapsed = true;
    t = t.replace(COLLAPSED, "");
  }
  const cm = t.match(COLOR_RE);
  if (cm) {
    t = t.replace(COLOR_RE, "");
    const c = cm[1].toLowerCase();
    if (isValidColor(c)) color = c;
  }
  const am = t.match(ANCHOR_RE);
  if (am) {
    anchor = am[1];
    t = t.replace(ANCHOR_RE, "");
  }
  t = t.replace(/<br\s*\/?>/gi, "\n").trim();
  if (/^\\\[[ xX]\]\s/.test(t)) t = t.slice(1);
  t = t.replace(/&lt;(!--|br)/gi, "<$1").replace(/(\s)\\\^([A-Za-z0-9-]+)$/, "$1^$2");
  return { ...extra, text: t, collapsed, color, shape, anchor, links: links.length ? links : undefined, callout };
}

export function parseMarkdown(src: string, fallbackTitle = "Untitled"): ParsedDoc {
  let text = src.replace(/\r\n?/g, "\n");
  let frontmatter = "";
  const fm = text.match(/^---\n[\s\S]*?\n---\n?/);
  if (fm) {
    frontmatter = fm[0].endsWith("\n") ? fm[0] : fm[0] + "\n";
    text = text.slice(fm[0].length);
  }
  const lines = text.split("\n");

  const root = makeNode(fallbackTitle);
  let rootTitled = false;

  // Heading stack: nodes for heading levels. headingStack[0] is root.
  const headingStack: { level: number; node: MapNode }[] = [{ level: 1, node: root }];
  // List stack under the current heading.
  let listStack: { indent: number; node: MapNode }[] = [];
  let current: MapNode = root; // node that receives notes
  let currentIndent = -1;
  const noteBuf = new Map<MapNode, string[]>();
  const addNote = (n: MapNode, line: string) => {
    if (!noteBuf.has(n)) noteBuf.set(n, []);
    noteBuf.get(n)!.push(line);
  };
  let pendingBlank = false;

  for (const line of lines) {
    if (!line.trim()) {
      pendingBlank = true;
      continue;
    }
    const h = line.match(HEAD_RE);
    if (h && !line.startsWith(" ") && !line.startsWith("\t")) {
      const level = h[1].length;
      // Task box first, on the raw text, so an escaped "\[ ]" stays text.
      let raw = h[2];
      let task: "todo" | "done" | undefined;
      const tb = raw.match(/^\[([ xX])\]\s+/);
      if (tb) {
        task = tb[1] === " " ? "todo" : "done";
        raw = raw.slice(tb[0].length);
      }
      const cleaned = cleanText(raw);
      const t = cleaned.text;
      if (level === 1 && !rootTitled && root.children.length === 0) {
        root.text = t;
        root.collapsed = false;
        applyMeta(root, { ...cleaned, collapsed: false });
        if (task) root.task = task;
        rootTitled = true;
        current = root;
        currentIndent = -1;
        listStack = [];
        pendingBlank = false;
        continue;
      }
      while (headingStack.length > 1 && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      const parent = headingStack[headingStack.length - 1].node;
      const n = makeNode(t);
      applyMeta(n, cleaned);
      if (task) n.task = task;
      parent.children.push(n);
      headingStack.push({ level, node: n });
      listStack = [];
      current = n;
      currentIndent = -1;
      pendingBlank = false;
      continue;
    }
    const m = line.match(LIST_RE);
    if (m) {
      const ind = indentWidth(m[1]);
      // A list line indented deeper than the item content but inside a quote? Not possible: quotes start with '>'.
      while (listStack.length && listStack[listStack.length - 1].indent >= ind) listStack.pop();
      const parent = listStack.length ? listStack[listStack.length - 1].node : headingStack[headingStack.length - 1].node;
      const cleaned = cleanText(m[3]);
      const n = makeNode(cleaned.text);
      if (m[2] !== undefined) n.task = m[2] === " " ? "todo" : "done";
      applyMeta(n, cleaned);
      parent.children.push(n);
      listStack.push({ indent: ind, node: n });
      current = n;
      currentIndent = ind;
      pendingBlank = false;
      continue;
    }
    // Note or continuation line.
    const lead = line.match(/^(\s*)/)![1];
    const body = line.slice(lead.length);
    const ind = indentWidth(lead);
    // Resolve which node owns this line: the deepest list item whose indent < ind.
    let owner: MapNode = current;
    if (currentIndent >= 0 && ind <= currentIndent) {
      // Dedented text: belongs to the nearest list ancestor with smaller indent, or the heading.
      let found: MapNode | null = null;
      for (let i = listStack.length - 1; i >= 0; i--) {
        if (listStack[i].indent < ind) {
          found = listStack[i].node;
          break;
        }
      }
      owner = found ?? headingStack[headingStack.length - 1].node;
      if (!found) {
        listStack = [];
        currentIndent = -1;
        current = owner;
      }
    }
    let noteLine: string;
    if (body.startsWith(">")) noteLine = body.replace(/^>\s?/, "");
    else noteLine = body;
    const buf = noteBuf.get(owner);
    if (pendingBlank && buf && buf.length) buf.push("");
    addNote(owner, noteLine);
    pendingBlank = false;
  }

  for (const [n, buf] of noteBuf) {
    // trim leading/trailing blank lines
    while (buf.length && !buf[0].trim()) buf.shift();
    while (buf.length && !buf[buf.length - 1].trim()) buf.pop();
    n.note = buf.join("\n");
  }
  if (!rootTitled && root.text === fallbackTitle && root.children.length === 1 && !root.note) {
    // A file that is just "- Title" with children: promote that item to root.
    const only = root.children[0];
    return { root: only, frontmatter };
  }
  return { root, frontmatter };
}

/** Hidden markers after a topic's text. The ^anchor (Obsidian block id) must come last. */
function suffix(n: MapNode, withFold: boolean, withAnchor = true): string {
  let s = "";
  if (withFold && n.collapsed && n.children.length) s += " " + COLLAPSED;
  if (n.color) s += ` <!--color:${n.color}-->`;
  if (n.shape) s += ` <!--shape:${n.shape}-->`;
  for (const l of n.links ?? []) {
    const lab = n.linkLabels?.[l];
    s += lab ? ` <!--link:${l}: ${markerText(lab)}-->` : ` <!--link:${l}-->`;
  }
  if (n.callout) s += ` <!--callout:${markerText(n.callout)}-->`;
  if (n.plan) {
    const ps = planToString(n.plan);
    if (ps) s += ` <!--plan:${ps}-->`;
  }
  if (n.labels?.length) s += ` <!--labels:${n.labels.map((l) => markerText(l).replace(/\|/g, "/")).join("|")}-->`;
  if (n.boundary !== undefined) s += n.boundary ? ` <!--boundary:${markerText(n.boundary)}-->` : " <!--boundary-->";
  if (n.summary) s += ` <!--summary:${n.summary}-->`;
  if (n.xref) s += ` <!--xref:${markerText(n.xref)}-->`;
  if (n.anchor && withAnchor) s += ` ^${n.anchor}`;
  return s;
}

/** Topic text that can't be mistaken for Ramify's own markers when read back:
 *  "<!--" and a literal "<br>" are written as "&lt;…", and a trailing " ^word"
 *  (which Obsidian would read as a block id) as " \^word". */
function escText(t: string): string {
  return t.replace(/<(!--|br)/gi, "&lt;$1").replace(/(\s)\^([A-Za-z0-9-]+)(\s*)$/, "$1\\^$2$3");
}

function escItem(t: string): string {
  let s = escText(t).replace(/\n/g, "<br>");
  // Keep text from being re-read as a task box or heading.
  if (/^\[[ xX]\]\s/.test(s)) s = "\\" + s;
  return s;
}

function quote(note: string, pad: string): string[] {
  return note.split("\n").map((l) => (l.length ? `${pad}> ${l}` : `${pad}>`));
}

export function serializeMarkdown(root: MapNode, frontmatter = ""): string {
  const out: string[] = [];
  if (frontmatter) out.push(frontmatter.replace(/\n$/, ""));
  const rbox = root.task === "todo" ? "[ ] " : root.task === "done" ? "[x] " : "";
  out.push(`# ${rbox}${escItem(root.text.replace(/\n/g, " ")) || "Untitled"}${suffix(root, false)}`);
  if (root.note.trim()) {
    out.push("");
    out.push(...quote(root.note, ""));
  }
  if (root.children.length) out.push("");
  const rec = (n: MapNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const box = n.task === "todo" ? "[ ] " : n.task === "done" ? "[x] " : "";
    out.push(`${pad}- ${box}${escItem(n.text)}${suffix(n, true)}`);
    if (n.note.trim()) out.push(...quote(n.note, pad + "  "));
    for (const c of n.children) rec(c, depth + 1);
  };
  for (const c of root.children) rec(c, 0);
  return out.join("\n") + "\n";
}

/**
 * Export as a document: every level is a heading (# central topic, ## branches,
 * ### sub-branches …). Below ###### topics become nested bullets. Notes become
 * normal Markdown paragraphs under their heading. Fold state is ignored (all shown).
 */
export function headingsMarkdown(top: MapNode, frontmatter = ""): string {
  const out: string[] = [];
  if (frontmatter) out.push(frontmatter.replace(/\n$/, ""), "");
  const box = (n: MapNode) => (n.task === "todo" ? "[ ] " : n.task === "done" ? "[x] " : "");
  const one = (t: string) => t.replace(/\n/g, " ").trim();
  let inList = false;
  const rec = (n: MapNode, depth: number) => {
    if (depth <= 5) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(`${"#".repeat(depth + 1)} ${box(n)}${one(n.text) || "Untitled"}`);
      out.push("");
      if (n.note.trim()) out.push(n.note.trim(), "");
      inList = false;
    } else {
      if (!inList && out.length && out[out.length - 1] !== "") out.push("");
      inList = true;
      const pad = "  ".repeat(depth - 6);
      out.push(`${pad}- ${box(n)}${escItem(n.text)}`);
      if (n.note.trim()) out.push(...quote(n.note, pad + "  "));
    }
    n.children.forEach((c) => rec(c, depth + 1));
  };
  rec(top, 0);
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

/** Branch as a plain Markdown outline (for clipboard). */
export function branchToMarkdown(n: MapNode): string {
  const out: string[] = [];
  const rec = (x: MapNode, depth: number) => {
    const box = x.task === "todo" ? "[ ] " : x.task === "done" ? "[x] " : "";
    out.push(`${"  ".repeat(depth)}- ${box}${escItem(x.text)}${suffix(x, false, false)}`);
    if (x.note.trim()) out.push(...quote(x.note, "  ".repeat(depth + 1)));
    x.children.forEach((c) => rec(c, depth + 1));
  };
  rec(n, 0);
  return out.join("\n") + "\n";
}

/**
 * Text pasted into the map: returns top-level nodes. Handles Markdown outlines,
 * indented plain text (tabs/spaces), and one-topic-per-line text.
 */
export function parsePastedText(src: string): MapNode[] {
  const text = src.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!text.trim()) return [];
  const isMd = text.split("\n").some((l) => LIST_RE.test(l) || HEAD_RE.test(l));
  if (isMd) {
    const { root } = parseMarkdown(text, "\u0000");
    return root.text === "\u0000" ? root.children : [root];
  }
  // Indented plain text.
  const root = makeNode("");
  const stack: { indent: number; node: MapNode }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const ind = indentWidth(line.match(/^(\s*)/)![1]);
    while (stack.length && stack[stack.length - 1].indent >= ind) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].node : root;
    const n = makeNode(line.trim());
    parent.children.push(n);
    stack.push({ indent: ind, node: n });
  }
  return root.children;
}
