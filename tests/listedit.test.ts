import { describe, it, expect } from "vitest";
import { continueList, indentList } from "../src/listedit";

const at = (s: string) => {
  const i = s.indexOf("|");
  return { v: s.replace("|", ""), i };
};
const run = (s: string) => {
  const { v, i } = at(s);
  const e = continueList(v, i, i);
  return e && e.value.slice(0, e.caret) + "|" + e.value.slice(e.caret);
};

describe("notes list editing", () => {
  it("continues tasks unchecked", () => expect(run("- [x] milk|")).toBe("- [x] milk\n- [ ] |"));
  it("continues bullets", () => expect(run("* a|")).toBe("* a\n* |"));
  it("numbers up", () => expect(run("1. a\n2. b|")).toBe("1. a\n2. b\n3. |"));
  it("keeps indent", () => expect(run("- a\n  - b|")).toBe("- a\n  - b\n  - |"));
  it("ends the list on an empty item", () => expect(run("- a\n- |")).toBe("- a\n|"));
  it("outdents an empty nested item", () => expect(run("- a\n  - |")).toBe("- a\n- |"));
  it("ignores plain text", () => expect(run("hello|")).toBeNull());
  it("splits text in the middle", () => expect(run("- ab|cd")).toBe("- ab\n- |cd"));
  it("indents with tab", () => expect(indentList("- a\n- b", 6, 6, false)?.value).toBe("- a\n  - b"));
  it("outdents with shift-tab", () => expect(indentList("- a\n  - b", 8, 8, true)?.value).toBe("- a\n- b"));
  it("tab on plain text is left alone", () => expect(indentList("abc", 1, 1, false)).toBeNull());
});

describe("nested numbering", () => {
  it("restarts at 1 when nesting", () => expect(indentList("1. a\n12. b", 9, 9, false)?.value).toBe("1. a\n  1. b"));
});
