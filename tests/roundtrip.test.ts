import { it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { makeNode } from "../src/model";
const texts = ["price ^2", "x^y", "a <!--color:red--> b", "> quoted", "# not heading", "[ ] not task", "1. first", "- dash", "line1\nline2", "tab\there", "  lead", "trail  ", "a | b", "**bold**", "emoji 🔥", "back\\slash", "<br> literal", "ends with \\", "50% off", "-->", "<!--", "^abc", "#tag", "* star", "+ plus", "a -- b --> c", "[x] done-looking"];
it("round-trips odd topic texts", () => {
  const root = makeNode("Root ^x");
  root.note = "> nested quote\n- [ ] task in note\n# heading in note";
  for (const t of texts) { const n = makeNode(t); n.note = t; root.children.push(n); }
  const md = serializeMarkdown(root);
  const back = parseMarkdown(md).root;
  const got = back.children.map((c) => c.text);
  const bad = texts.map((t, i) => [t, got[i]]).filter(([a, b]) => a.trim() !== b);
  expect({ bad, rootText: back.text, rootNote: back.note }).toEqual({ bad: [], rootText: "Root ^x", rootNote: root.note });
  const badNotes = texts.map((t, i) => [t, back.children[i]?.note]).filter(([a, b]) => a.trim() !== (b ?? "").trim());
  expect(badNotes).toEqual([]);
});
it("keeps a heading that looks like a task box", () => {
  const r = makeNode("[ ] not task");
  const back = parseMarkdown(serializeMarkdown(r)).root;
  expect([back.text, back.task]).toEqual(["[ ] not task", undefined]);
  const t = makeNode("real task");
  t.task = "todo";
  expect(parseMarkdown(serializeMarkdown(t)).root.task).toBe("todo");
});
