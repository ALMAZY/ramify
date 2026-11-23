// Markdown list editing in the notes box: Enter continues a list, Tab nests it.

export interface Edit {
  value: string;
  caret: number;
}

const ITEM = /^(\s*)(?:([-*+])\s\[[ xX]\]\s|([-*+])\s|(\d+)([.)])\s)/;

/** Enter at the end of (or inside) a list line.
 *  - "- [ ] buy milk|"  → new line "- [ ] |" (always unchecked)
 *  - "- item|"          → "- |"
 *  - "3. step|"         → "4. |"
 *  - an empty item      → the marker is removed and the list ends
 *  Returns null when the line is not a list item (normal Enter). */
export function continueList(value: string, start: number, end: number): Edit | null {
  if (start !== end) return null;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", start);
  const lineEnd = nl === -1 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);
  const m = line.match(ITEM);
  if (!m) return null;
  const marker = m[0];
  // Caret inside the marker itself: behave like a normal Enter.
  if (start - lineStart < marker.length) return null;
  const rest = line.slice(marker.length);
  if (!rest.trim()) {
    // Empty item: end the list (or step out one level if nested).
    const indent = m[1];
    const out = indent.length >= 2 ? indent.slice(2) + marker.slice(indent.length) : "";
    return { value: value.slice(0, lineStart) + out + value.slice(lineEnd), caret: lineStart + out.length };
  }
  const indent = m[1];
  let next: string;
  if (m[2]) next = `${indent}${m[2]} [ ] `;
  else if (m[3]) next = `${indent}${m[3]} `;
  else next = `${indent}${Number(m[4]) + 1}${m[5]} `;
  const ins = "\n" + next;
  return { value: value.slice(0, start) + ins + value.slice(end), caret: start + ins.length };
}

/** Tab / Shift+Tab on a list line: indent or outdent it by two spaces. */
export function indentList(value: string, start: number, end: number, out: boolean): Edit | null {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  if (!lines.every((l) => ITEM.test(l) || !l.trim())) return null;
  let delta = 0;
  const changed = lines.map((l, i) => {
    if (!l.trim()) return l;
    if (!out) {
      if (i === 0) delta = 2;
      // A nested numbered list starts again at 1.
      if (lines.length === 1) {
        const n = l.match(/^(\s*)(\d+)([.)]\s)/);
        if (n) {
          if (i === 0) delta = 2 + 1 - n[2].length;
          return "  " + n[1] + "1" + l.slice(n[1].length + n[2].length);
        }
      }
      return "  " + l;
    }
    const cut = l.startsWith("  ") ? 2 : l.startsWith(" ") ? 1 : 0;
    if (i === 0) delta = -cut;
    return l.slice(cut);
  });
  const text = changed.join("\n");
  return {
    value: value.slice(0, lineStart) + text + value.slice(lineEnd),
    caret: Math.max(lineStart, start + delta),
  };
}

/** Wire both behaviours to a textarea. Uses execCommand so ⌘Z still works. */
export function attachListEditing(ta: HTMLTextAreaElement) {
  ta.addEventListener("keydown", (e) => {
    if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
    let edit: Edit | null = null;
    if (e.key === "Enter" && !e.shiftKey) edit = continueList(ta.value, ta.selectionStart, ta.selectionEnd);
    else if (e.key === "Tab") edit = indentList(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
    if (!edit) return;
    e.preventDefault();
    e.stopPropagation();
    replaceAll(ta, edit);
  });
}

function replaceAll(ta: HTMLTextAreaElement, edit: Edit) {
  // Replace only the part that changed, so the undo step stays small.
  const a = ta.value,
    b = edit.value;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length,
    eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  ta.focus();
  ta.setSelectionRange(s, ea);
  const ok = document.execCommand?.("insertText", false, b.slice(s, eb));
  if (!ok || ta.value !== b) {
    ta.value = b;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ta.setSelectionRange(edit.caret, edit.caret);
}
