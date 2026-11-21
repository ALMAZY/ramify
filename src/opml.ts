import { MapNode, makeNode } from "./model";
import { isValidColor } from "./colors";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

export function toOPML(root: MapNode): string {
  const lines: string[] = [];
  const rec = (n: MapNode, depth: number) => {
    const pad = "  ".repeat(depth + 2);
    let attrs = `text="${esc(n.text)}"`;
    if (n.note) attrs += ` _note="${esc(n.note)}"`;
    if (n.task === "done") attrs += ` _complete="true"`;
    if (n.task === "todo") attrs += ` _complete="false"`;
    if (n.color) attrs += ` _color="${esc(n.color)}"`;
    if (!n.children.length) lines.push(`${pad}<outline ${attrs}/>`);
    else {
      lines.push(`${pad}<outline ${attrs}>`);
      n.children.forEach((c) => rec(c, depth + 1));
      lines.push(`${pad}</outline>`);
    }
  };
  rec(root, 0);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<opml version="2.0">`,
    `  <head><title>${esc(root.text)}</title></head>`,
    `  <body>`,
    ...lines,
    `  </body>`,
    `</opml>`,
    "",
  ].join("\n");
}

export function fromOPML(xml: string, fallbackTitle = "Imported"): MapNode {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid OPML file");
  const body = doc.querySelector("body");
  if (!body) throw new Error("OPML has no <body>");
  const conv = (el: Element): MapNode => {
    const n = makeNode(el.getAttribute("text") ?? el.getAttribute("title") ?? "");
    n.note = el.getAttribute("_note") ?? "";
    const c = el.getAttribute("_complete");
    if (c === "true") n.task = "done";
    else if (c === "false") n.task = "todo";
    const col = el.getAttribute("_color")?.toLowerCase();
    if (isValidColor(col)) n.color = col;
    n.children = Array.from(el.children).filter((x) => x.tagName === "outline").map(conv);
    return n;
  };
  const tops = Array.from(body.children).filter((x) => x.tagName === "outline");
  if (tops.length === 1) return conv(tops[0]);
  const title = doc.querySelector("head > title")?.textContent?.trim() || fallbackTitle;
  const root = makeNode(title);
  root.children = tops.map(conv);
  return root;
}
