import { describe, it, expect } from "vitest";
import { parseMarkdown } from "../src/markdown";
import { addDays, progressOf, reschedule, scheduled, span, spanDays, rollup } from "../src/plan";
import { layout } from "../src/layout";

describe("dates", () => {
  it("counts both ends", () => expect(spanDays("2026-09-20", "2026-09-29")).toBe(10));
  it("adds days across months", () => expect(addDays("2026-09-30", 1)).toBe("2026-10-01"));
  it("span of a one-date plan", () => expect(span({ start: "2026-01-05" })).toEqual({ start: "2026-01-05", due: "2026-01-05", days: 1 }));
});

const md = `# P
- A <!--plan:start=2026-09-20;due=2026-09-29--> ^a
- B <!--plan:start=2026-09-25;due=2026-09-27;after=a--> ^b
- C <!--plan:start=2026-11-01;due=2026-11-02;after=b-->
- D
  - [x] one
  - [ ] two
  - E <!--plan:progress=40;start=2026-10-01;due=2026-10-02-->
`;

describe("scheduling", () => {
  it("pushes successors after predecessors, keeping their length", () => {
    const { root } = parseMarkdown(md);
    const changed = reschedule(root);
    expect(root.children[1].plan).toMatchObject({ start: "2026-09-30", due: "2026-10-02" });
    expect(root.children[2].plan).toMatchObject({ start: "2026-11-01" }); // already later: untouched
    expect(changed.size).toBe(1);
  });
  it("works out progress from sub-tasks", () => {
    const { root } = parseMarkdown(md);
    expect(progressOf(root.children[3])).toBe(Math.round((100 + 0 + 40) / 3));
  });
  it("lists dated topics with their groups, rolls up group dates", () => {
    const { root } = parseMarkdown(md);
    expect(scheduled(root).map((r) => r.node.text)).toEqual(["P", "A", "B", "C", "D", "E"]);
    expect(rollup(root.children[3])).toEqual({ start: "2026-10-01", due: "2026-10-02" });
  });
});

describe("layout extras", () => {
  const src = `# R
- a
- b <!--boundary:Box-->
  - b1
- s <!--summary:2-->
- c
`;
  const { root } = parseMarkdown(src);
  const sizes = new Map<string, { w: number; h: number }>();
  const all = [root, ...root.children, root.children[1].children[0]];
  all.forEach((n) => sizes.set(n.id, { w: 60, h: 28 }));
  for (const kind of ["right", "mindmap", "timeline", "brace", "down"] as const) {
    it(`places every topic without overlap (${kind})`, () => {
      const boxes = [...layout(root, sizes, kind).values()];
      expect(boxes.length).toBe(all.length);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
    });
  }
  it("puts the summary beside the topics it sums up", () => {
    const boxes = layout(root, sizes, "right");
    const s = boxes.get(root.children[2].id)!;
    expect(s.brace).toBeTruthy();
    const b1 = boxes.get(root.children[1].children[0].id)!;
    expect(s.x).toBeGreaterThan(b1.x + b1.w);
  });
});
