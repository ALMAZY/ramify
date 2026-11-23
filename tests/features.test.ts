import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { fromXMind, fromJSON } from "../src/importers";
import { exportJSON, exportText } from "../src/exporter";
import { taskStats, toggleTask, noteLinks } from "../src/notes";
import { relLink, resolveLink, dirOf, fileNameFor } from "../src/storage";
import { layout } from "../src/layout";
import { parseMarkdown } from "../src/markdown";
import { resolveColors } from "../src/colors";

describe("importers", () => {
  it("reads XMind (JSON format)", () => {
    const content = [{ rootTopic: { title: "Root", children: { attached: [{ title: "A", notes: { plain: { content: "n" } } }, { title: "B", markers: [{ markerId: "task-done" }] }] } } }];
    const root = fromXMind(zipSync({ "content.json": strToU8(JSON.stringify(content)) }), "x");
    expect(root.text).toBe("Root");
    expect(root.children.map((c) => [c.text, c.note, c.task])).toEqual([["A", "n", undefined], ["B", "", "done"]]);
  });
  it("round-trips Ramify JSON", () => {
    const { root } = parseMarkdown("# M\n\n- [ ] A <!--color:red-->\n  > note\n  - B\n");
    const back = fromJSON(exportJSON(root));
    expect(back.children[0]).toMatchObject({ text: "A", task: "todo", color: "red", note: "note" });
    expect(exportText(root)).toBe("M\n\t[ ] A\n\t\tB\n");
  });
});

describe("notes", () => {
  it("counts and toggles checklist items", () => {
    const note = "- [ ] a\n* [x] b\n1. [ ] c\nplain";
    expect(taskStats(note)).toEqual({ done: 1, total: 3 });
    expect(toggleTask(note, 2)).toBe("- [ ] a\n* [x] b\n1. [x] c\nplain");
    expect(toggleTask(note, 1)).toBe("- [ ] a\n* [ ] b\n1. [ ] c\nplain");
  });
  it("finds attachment links but not web links", () => {
    expect(noteLinks("![p](attachments/p.png) [f](../attachments/a%20b.pdf) [w](https://x.y)")).toEqual([
      { text: "p", href: "attachments/p.png", image: true },
      { text: "f", href: "../attachments/a%20b.pdf", image: false },
    ]);
  });
});

describe("paths", () => {
  it("builds and resolves links relative to the map", () => {
    expect(relLink("Courses/Physics/L1.md", "attachments/a.png")).toBe("../../attachments/a.png");
    expect(relLink("L1.md", "attachments/a.png")).toBe("attachments/a.png");
    expect(resolveLink("Courses/Physics/L1.md", "../../attachments/a%20b.png")).toBe("attachments/a b.png");
    expect(resolveLink("x.md", "https://a.b")).toBeNull();
    expect(dirOf("a/b/c.md")).toBe("a/b");
    expect(fileNameFor("A/B: C?")).toBe("AB C.md");
  });
});

describe("layouts and colours", () => {
  const { root } = parseMarkdown("# R\n\n- A\n  - A1\n    - A1a\n- B <!--color:#123456-->\n  - B1\n");
  const sizes = new Map<string, { w: number; h: number }>();
  const all: string[] = [];
  const rec = (n: any) => (all.push(n.id), sizes.set(n.id, { w: 80, h: 24 }), n.children.forEach(rec));
  rec(root);
  it("places every topic in all four layouts without overlap", () => {
    for (const kind of ["mindmap", "right", "left", "down"] as const) {
      const boxes = layout(root, sizes, kind);
      expect(boxes.size).toBe(all.length);
      const list = [...boxes.values()];
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${kind} overlap`).toBe(false);
        }
    }
  });
  it("left layout grows left, down layout grows down", () => {
    const l = layout(root, sizes, "left");
    expect(l.get(root.children[0].id)!.x).toBeLessThan(l.get(root.id)!.x);
    const d = layout(root, sizes, "down");
    expect(d.get(root.children[0].id)!.y).toBeGreaterThan(d.get(root.id)!.y);
    expect(d.get(root.children[0].children[0].id)!.stack).toBe(true);
  });
  it("inherits colours down a branch, also under folded topics", () => {
    root.children[1].collapsed = true;
    const c = resolveColors(root);
    expect(c.get(root.children[1].children[0].id)).toBe("#123456");
    expect(c.get(root.children[0].children[0].id)).toBe("orange");
  });
});

import { routeLinks } from "../src/router";
describe("link routing", () => {
  it("goes around a topic that sits between the two linked topics", () => {
    const mk = (x: number, y: number, w = 80, h = 24) => ({ x, y, w, h, side: 1 as const, depth: 1, parent: null });
    const boxes = new Map([
      ["a", mk(0, 0)],
      ["wall", mk(140, -60, 60, 150)],
      ["b", mk(260, 0)],
    ]);
    const [d] = routeLinks(boxes, [{ from: "a", to: "b" }]);
    expect(d).toMatch(/^M/);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const pts: [number, number][] = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    // densify straight segments and check none is inside the wall
    const w = boxes.get("wall")!;
    for (let i = 1; i < pts.length; i++)
      for (let t = 0; t <= 1; t += 0.05) {
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
          y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
        expect(x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h).toBe(false);
      }
  });
});
