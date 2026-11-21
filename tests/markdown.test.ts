import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown, parsePastedText, branchToMarkdown } from "../src/markdown";
import { MapNode, indent, outdent, addSibling, remove, moveTo, find } from "../src/model";

const strip = (n: MapNode): any => ({
  text: n.text,
  ...(n.note ? { note: n.note } : {}),
  ...(n.task ? { task: n.task } : {}),
  ...(n.collapsed ? { collapsed: true } : {}),
  ...(n.children.length ? { children: n.children.map(strip) } : {}),
});

const sample = `---
course: Algorithms
---
# Lecture 3 — Sorting

> Prof. Smith
> room 204

- Quicksort
  > pivot choice matters
  >
  > worst case O(n²)
  - [ ] review partition
  - [x] average O(n log n)
- Merge sort <!--collapsed-->
  - stable
  - line one<br>line two
- \\[ ] not a task
`;

describe("markdown", () => {
  it("parses the native format", () => {
    const { root, frontmatter } = parseMarkdown(sample);
    expect(frontmatter).toBe("---\ncourse: Algorithms\n---\n");
    expect(strip(root)).toEqual({
      text: "Lecture 3 — Sorting",
      note: "Prof. Smith\nroom 204",
      children: [
        {
          text: "Quicksort",
          note: "pivot choice matters\n\nworst case O(n²)",
          children: [
            { text: "review partition", task: "todo" },
            { text: "average O(n log n)", task: "done" },
          ],
        },
        { text: "Merge sort", collapsed: true, children: [{ text: "stable" }, { text: "line one\nline two" }] },
        { text: "[ ] not a task" },
      ],
    });
  });

  it("round-trips byte for byte", () => {
    const { root, frontmatter } = parseMarkdown(sample);
    expect(serializeMarkdown(root, frontmatter)).toBe(sample);
  });

  it("imports headings, tabs, numbered lists and plain paragraphs", () => {
    const md = `# Course\nIntro text\n\n## Week 1\n1. Sets\n\t* union\n\t* intersection\n## Week 2\nsome paragraph\n+ Graphs\n`;
    const { root } = parseMarkdown(md);
    expect(strip(root)).toEqual({
      text: "Course",
      note: "Intro text",
      children: [
        { text: "Week 1", children: [{ text: "Sets", children: [{ text: "union" }, { text: "intersection" }] }] },
        { text: "Week 2", note: "some paragraph", children: [{ text: "Graphs" }] },
      ],
    });
  });

  it("uses the filename when there is no H1 and promotes a lone top item", () => {
    expect(parseMarkdown("- a\n- b\n", "file").root.text).toBe("file");
    const r = parseMarkdown("- Only\n  - x\n", "file").root;
    expect(strip(r)).toEqual({ text: "Only", children: [{ text: "x" }] });
  });

  it("parses pasted text", () => {
    expect(parsePastedText("a\n\tb\n\tc\nd").map(strip)).toEqual([
      { text: "a", children: [{ text: "b" }, { text: "c" }] },
      { text: "d" },
    ]);
    expect(parsePastedText("- x\n  - y").map(strip)).toEqual([{ text: "x", children: [{ text: "y" }] }]);
    const b = parseMarkdown(sample).root.children[0];
    expect(parsePastedText(branchToMarkdown(b)).map(strip)).toEqual([strip(b)]);
  });
});

describe("model ops", () => {
  const build = () => parseMarkdown("# R\n- a\n- b\n  - b1\n- c\n").root;
  it("indents and outdents", () => {
    const r = build();
    const b = r.children[1];
    expect(indent(r, b.id)).toBe(true);
    expect(strip(r).children.map((x: any) => x.text)).toEqual(["a", "c"]);
    expect(find(r, b.id)!.depth).toBe(2);
    expect(outdent(r, b.id)).toBe(true);
    expect(strip(r).children.map((x: any) => x.text)).toEqual(["a", "b", "c"]);
  });
  it("adds, removes and moves", () => {
    const r = build();
    const id = addSibling(r, r.children[0].id)!;
    expect(r.children[1].id).toBe(id);
    expect(remove(r, id)).toBe(r.children[0].id);
    expect(moveTo(r, r.children[1].id, r.children[1].children[0].id, "child")).toBe(false); // into own descendant
    expect(moveTo(r, r.children[2].id, r.children[0].id, "before")).toBe(true);
    expect(r.children.map((x) => x.text)).toEqual(["c", "a", "b"]);
  });
});

describe("colours", () => {
  it("round-trips named and custom colours and ignores invalid ones", () => {
    const md = "# Map <!--color:#ff8800-->\n\n- A <!--color:blue-->\n  - B <!--collapsed--> <!--color:red-->\n    - C\n- D <!--color:javascript-->\n";
    const { root } = parseMarkdown(md);
    expect(root.color).toBe("#ff8800");
    expect(root.children[0].color).toBe("blue");
    expect(root.children[0].children[0]).toMatchObject({ text: "B", color: "red", collapsed: true });
    expect(root.children[1].color).toBeUndefined();
    expect(root.children[1].text).toBe("D");
    expect(serializeMarkdown(root)).toBe(md.replace(" <!--color:javascript-->", ""));
  });
});
