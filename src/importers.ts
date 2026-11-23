// Import from XMind (.xmind, new JSON and legacy XML), FreeMind / Freeplane (.mm),
// Ramify JSON, OPML, Markdown and plain text.

import { unzipSync, strFromU8 } from "fflate";
import { MapNode, makeNode } from "./model";
import { parseMarkdown, parsePastedText } from "./markdown";
import { fromOPML } from "./opml";
import { isValidColor } from "./colors";

export const IMPORT_EXTENSIONS = ["md", "markdown", "txt", "opml", "xml", "xmind", "mm", "json"];

export function importAny(name: string, text: string, bytes: Uint8Array): MapNode {
  const base = name.replace(/\.[^.]+$/, "");
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (ext === "xmind") return fromXMind(bytes, base);
  if (ext === "mm") return fromFreeMind(text, base);
  if (ext === "json") return fromJSON(text);
  if (ext === "opml" || ext === "xml") return fromOPML(text, base);
  if (ext === "txt") {
    const root = makeNode(base);
    root.children = parsePastedText(text);
    return root;
  }
  return parseMarkdown(text, base).root;
}

// ---------------------------------------------------------------- XMind

export function fromXMind(bytes: Uint8Array, fallback: string): MapNode {
  const files = unzipSync(bytes);
  if (files["content.json"]) {
    const sheets = JSON.parse(strFromU8(files["content.json"]));
    const sheet = Array.isArray(sheets) ? sheets[0] : sheets;
    if (!sheet?.rootTopic) throw new Error("XMind file has no root topic");
    return xmindTopic(sheet.rootTopic);
  }
  if (files["content.xml"]) {
    const doc = new DOMParser().parseFromString(strFromU8(files["content.xml"]), "text/xml");
    const topic = doc.getElementsByTagName("topic")[0];
    if (!topic) throw new Error("XMind file has no topics");
    return xmindXmlTopic(topic);
  }
  const root = makeNode(fallback);
  return root;
}

function xmindTopic(t: any): MapNode {
  const n = makeNode(String(t.title ?? "").trim());
  const note = t.notes?.plain?.content ?? t.notes?.realHTML?.content?.replace(/<[^>]+>/g, "");
  if (note) n.note = String(note).trim();
  const attached = t.children?.attached ?? [];
  const detached = t.children?.detached ?? [];
  n.children = [...attached, ...detached].map(xmindTopic);
  if (t.branch === "folded") n.collapsed = true;
  const markers: string[] = (t.markers ?? []).map((m: any) => m.markerId ?? "");
  if (markers.some((m) => m === "task-done")) n.task = "done";
  else if (markers.some((m) => m.startsWith("task-"))) n.task = "todo";
  return n;
}

function xmindXmlTopic(el: Element): MapNode {
  const title = Array.from(el.children).find((c) => c.tagName === "title")?.textContent ?? "";
  const n = makeNode(title.trim());
  const notes = Array.from(el.children).find((c) => c.tagName === "notes");
  const plain = notes?.getElementsByTagName("plain")[0]?.textContent;
  if (plain) n.note = plain.trim();
  const children = Array.from(el.children).find((c) => c.tagName === "children");
  if (children) {
    for (const topics of Array.from(children.children).filter((c) => c.tagName === "topics")) {
      for (const t of Array.from(topics.children).filter((c) => c.tagName === "topic")) n.children.push(xmindXmlTopic(t));
    }
  }
  if (el.getAttribute("branch") === "folded") n.collapsed = true;
  return n;
}

// ---------------------------------------------------------------- FreeMind / Freeplane

export function fromFreeMind(xml: string, fallback: string): MapNode {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid FreeMind file");
  const top = doc.querySelector("map > node");
  if (!top) return makeNode(fallback);
  const conv = (el: Element): MapNode => {
    let text = el.getAttribute("TEXT") ?? "";
    let note = "";
    for (const rc of Array.from(el.children).filter((c) => c.tagName === "richcontent")) {
      const plain = (rc.textContent ?? "").replace(/\s+\n/g, "\n").trim();
      const type = (rc.getAttribute("TYPE") ?? "").toUpperCase();
      if (type === "NOTE" || type === "DETAILS") note += (note ? "\n\n" : "") + plain;
      else if (!text) text = plain;
    }
    const n = makeNode(text.trim());
    n.note = note;
    if (el.getAttribute("FOLDED") === "true") n.collapsed = true;
    const c = el.getAttribute("COLOR")?.toLowerCase();
    if (c && isValidColor(c) && c !== "#000000") n.color = c;
    n.children = Array.from(el.children)
      .filter((x) => x.tagName === "node")
      .map(conv);
    return n;
  };
  return conv(top);
}

// ---------------------------------------------------------------- JSON

export function fromJSON(text: string): MapNode {
  const data = JSON.parse(text);
  const conv = (o: any): MapNode => {
    const n = makeNode(String(o.text ?? o.title ?? ""));
    if (o.note) n.note = String(o.note);
    if (o.task === "todo" || o.task === "done") n.task = o.task;
    if (isValidColor(o.color)) n.color = o.color;
    if (o.collapsed) n.collapsed = true;
    n.children = (o.children ?? []).map(conv);
    return n;
  };
  return conv(data.root ?? data);
}
