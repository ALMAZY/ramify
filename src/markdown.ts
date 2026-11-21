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

import { MapNode, makeNode } from "./model";
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

function cleanText(raw: string): { text: string; collapsed: boolean; color?: string } {
  let t = raw;
  let collapsed = false;
  let color: string | undefined;
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
  t = t.replace(/<br\s*\/?>/gi, "\n").trim();
  if (/^\\\[[ xX]\]\s/.test(t)) t = t.slice(1);
  return { text: t, collapsed, color };
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
      const { text: t, collapsed, color } = cleanText(h[2]);
      if (level === 1 && !rootTitled && root.children.length === 0) {
        root.text = t;
        root.collapsed = false;
        if (color) root.color = color;
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
      if (collapsed) n.collapsed = true;
      if (color) n.color = color;
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
      const { text: t, collapsed, color } = cleanText(m[3]);
      const n = makeNode(t);
      if (m[2] !== undefined) n.task = m[2] === " " ? "todo" : "done";
      if (collapsed) n.collapsed = true;
      if (color) n.color = color;
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
  out.push(`# ${root.text.replace(/\n/g, " ") || "Untitled"}${root.color ? ` <!--color:${root.color}-->` : ""}`);
  if (root.note.trim()) {
    out.push("");
    out.push(...quote(root.note, ""));
  }
  if (root.children.length) out.push("");
  const rec = (n: MapNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const box = n.task === "todo" ? "[ ] " : n.task === "done" ? "[x] " : "";
    const fold = n.collapsed && n.children.length ? " " + COLLAPSED : "";
    const col = n.color ? ` <!--color:${n.color}-->` : "";
    out.push(`${pad}- ${box}${escItem(n.text)}${fold}${col}`);
    if (n.note.trim()) out.push(...quote(n.note, pad + "  "));
    for (const c of n.children) rec(c, depth + 1);
  };
  for (const c of root.children) rec(c, 0);
  return out.join("\n") + "\n";
}

/** Branch as a plain Markdown outline (for clipboard). */
export function branchToMarkdown(n: MapNode): string {
  const out: string[] = [];
  const rec = (x: MapNode, depth: number) => {
    const box = x.task === "todo" ? "[ ] " : x.task === "done" ? "[x] " : "";
    out.push(`${"  ".repeat(depth)}- ${box}${escItem(x.text)}${x.color ? ` <!--color:${x.color}-->` : ""}`);
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
