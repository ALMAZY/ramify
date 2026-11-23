import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";

const src = `# Website Redesign <!--plan:progress=40;priority=2;start=2026-09-20;due=2026-11-18-->

- Discovery <!--plan:start=2026-09-20;due=2026-09-29;who=Ann Lee;after=x1--> <!--labels:Product Manager|Marketing--> ^d1
  - [x] Interviews
- Planning <!--boundary:Structure, style, budget--> <!--link:d1: depends on-->
- Summary of both <!--summary:2-->
- Other map <!--xref:Lectures/math.md#ab12--> <!--boundary-->
`;

describe("topic metadata markers", () => {
  const { root } = parseMarkdown(src);
  it("reads plan", () => {
    expect(root.plan).toEqual({ progress: 40, priority: 2, start: "2026-09-20", due: "2026-11-18" });
    expect(root.children[0].plan).toEqual({ start: "2026-09-20", due: "2026-09-29", who: "Ann Lee", after: ["x1"] });
    expect(root.children[0].text).toBe("Discovery");
    expect(root.children[0].anchor).toBe("d1");
  });
  it("reads labels, boundary, summary, xref, link labels", () => {
    expect(root.children[0].labels).toEqual(["Product Manager", "Marketing"]);
    expect(root.children[1].boundary).toBe("Structure, style, budget");
    expect(root.children[1].links).toEqual(["d1"]);
    expect(root.children[1].linkLabels).toEqual({ d1: "depends on" });
    expect(root.children[2].summary).toBe(2);
    expect(root.children[3].xref).toBe("Lectures/math.md#ab12");
    expect(root.children[3].boundary).toBe("");
    expect(root.children[3].text).toBe("Other map");
  });
  it("round-trips", () => {
    const again = parseMarkdown(serializeMarkdown(root)).root;
    expect(serializeMarkdown(again)).toBe(serializeMarkdown(root));
    expect(again.children[0].plan?.who).toBe("Ann Lee");
  });
  it("ignores bad plan values", () => {
    const r = parseMarkdown("# A <!--plan:progress=x;priority=9;start=soon-->").root;
    expect(r.plan).toBeUndefined();
  });
});
