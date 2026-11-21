import { MapNode } from "./model";

/** Named colours follow the theme (light/dark). Index = CSS var --bN. */
export const COLOR_NAMES = ["orange", "blue", "green", "purple", "yellow", "teal", "red", "violet", "gray"] as const;

// Light-theme values, used for SVG/PNG export. Keep in sync with --b0..--b7 in styles.css.
export const COLOR_HEX = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#e03131", "#5f3dc4", "#868e96"];

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

export function isValidColor(c: string | undefined): c is string {
  return !!c && ((COLOR_NAMES as readonly string[]).includes(c) || HEX_RE.test(c));
}

/** CSS value for a colour token (name or #hex). */
export function cssColor(c: string): string {
  const i = (COLOR_NAMES as readonly string[]).indexOf(c);
  if (i === 8) return "var(--muted)";
  if (i >= 0) return `var(--b${i})`;
  return HEX_RE.test(c) ? c : "var(--muted)";
}

/** Fixed hex for export. */
export function hexColor(c: string): string {
  const i = (COLOR_NAMES as readonly string[]).indexOf(c);
  if (i >= 0) return COLOR_HEX[i];
  return HEX_RE.test(c) ? c : COLOR_HEX[8];
}

/**
 * Colour token for every visible topic under `top`.
 * First-level branches get an automatic colour by position; a topic's own colour
 * overrides it and is inherited by its whole branch.
 */
export function resolveColors(top: MapNode): Map<string, string> {
  const out = new Map<string, string>();
  if (top.color) out.set(top.id, top.color);
  const rec = (n: MapNode, inherited: string) => {
    const c = n.color ?? inherited;
    out.set(n.id, c);
    if (!n.collapsed) n.children.forEach((k) => rec(k, c));
  };
  top.children.forEach((c, i) => rec(c, COLOR_NAMES[i % 8]));
  return out;
}
