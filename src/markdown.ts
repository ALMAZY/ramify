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

import { MapNode, makeNode, Shape, SHAPES } from "./model";
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
const LINK_RE = /<!--\s*link:\s*([\w-]+)\s*-->/gi;
const ANCHOR_RE = /\s\^([A-Za-z0-9-]+)\s*$/;

interface Meta {
  collapsed?: boolean;
  color?: string;
  shape?: Shape;
  anchor?: string;
  links?: string[];
  callout?: string;
}

function applyMeta(n: MapNode, m: Meta) {
  if (m.collapsed) n.collapsed = true;
  if (m.color) n.color = m.color;
  if (m.shape) n.shape = m.shape;
  if (m.anchor) n.anchor = m.anchor;
  if (m.links?.length) n.links = m.links;
  if (m.callout) n.callout = m.callout;
}

function cleanText(raw: string): { text: string; collapsed: boolean; color?: string; shape?: Shape; anchor?: string; links?: string[]; callout?: string } {
  let t = raw;
  let callout: string | undefined;
  const co = t.match(CALLOUT_RE);
  if (co) {
    callout = co[1].trim() || undefined;
    t = t.replace(CALLOUT_RE, "");
  }
  let collapsed = false;
  let color: string | undefined;
  let shape: Shape | undefined;
  let anchor: string | undefined;
  const links: string[] = [];
  t = t.replace(LINK_RE, (_m, a: string) => {
    links.push(a);
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
  return { text: t, collapsed, color, shape, anchor, links: links.length ? links : undefined, callout };
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
      const cleaned = cleanText(h[2]);
      let t = cleaned.text;
      let task: "todo" | "done" | undefined;
      const tb = t.match(/^\[([ xX])\]\s+/);
      if (tb) {
        task = tb[1] === " " ? "todo" : "done";
        t = t.slice(tb[0].length);
      }
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
function suffix(n: MapNode, withFold: boolean): string {
  let s = "";
  if (withFold && n.collapsed && n.children.length) s += " " + COLLAPSED;
  if (n.color) s += ` <!--color:${n.color}-->`;
  if (n.shape) s += ` <!--shape:${n.shape}-->`;
  for (const l of n.links ?? []) s += ` <!--link:${l}-->`;
  if (n.callout) s += ` <!--callout:${n.callout.replace(/\s+/g, " ").replace(/--+>?/g, "—")}-->`;
  if (n.anchor) s += ` ^${n.anchor}`;
  return s;
}

function escItem(t: string): string {
  let s = t.replace(/\n/g, "<br>");
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
  out.push(`# ${rbox}${root.text.replace(/\n/g, " ") || "Untitled"}${suffix(root, false)}`);
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
    out.push(`${"  ".repeat(depth)}- ${box}${escItem(x.text)}${x.color ? ` <!--color:${x.color}-->` : ""}${x.shape ? ` <!--shape:${x.shape}-->` : ""}`);
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
