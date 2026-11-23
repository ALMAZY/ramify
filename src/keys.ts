export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Normalised chord like "Mod+Shift+K" for a keyboard event. Mod = ⌘ on Mac, Ctrl elsewhere. */
export function chord(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  if (isMac && e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let k = e.key;
  // With Alt on Mac, e.key is a special character; fall back to the physical key.
  if (e.altKey || mod) {
    if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (e.code === "Period") k = ".";
    else if (e.code === "BracketLeft") k = "[";
    else if (e.code === "BracketRight") k = "]";
    else if (e.code === "Equal") k = "=";
    else if (e.code === "Minus") k = "-";
    else if (e.code === "Slash") k = "/";
    else if (e.code === "Backslash") k = "\\";
    else if (e.code === "Semicolon") k = ";";
  }
  if (k === " ") k = "Space";
  if (k.length === 1) k = k.toUpperCase();
  // "?" already implies Shift.
  if (k === "?") return [...parts.filter((p) => p !== "Shift"), "?"].join("+");
  parts.push(k);
  return parts.join("+");
}

const SYM: Record<string, string> = isMac
  ? { Mod: "⌘", Shift: "⇧", Alt: "⌥", Ctrl: "⌃", Enter: "↩", Backspace: "⌫", Delete: "⌦", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Tab: "⇥", Space: "Space" }
  : { Mod: "Ctrl+", Shift: "Shift+", Alt: "Alt+", Enter: "Enter", Backspace: "⌫", Delete: "Del", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc", Tab: "Tab", Space: "Space" };

export function prettyChord(c: string): string {
  return c
    .split("+")
    .map((p) => SYM[p] ?? p)
    .join(isMac ? "" : "");
}
