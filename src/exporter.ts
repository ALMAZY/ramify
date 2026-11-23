// Export the map as SVG / PNG / PDF / HTML / JSON / plain text.
// SVG is drawn from the live layout: positions, line breaks and colours are
// read from the rendered map, so the export matches the screen and theme.

import type { App } from "./app";
import { edgePath, bounds, boundaryBoxes } from "./layout";
import { routeLinks } from "./router";
import { MapNode, find } from "./model";
import { hexColor } from "./colors";
import { cssVar } from "./themes";
import { headingsMarkdown } from "./markdown";
import { Marked } from "marked";

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Split the rendered text of `txt` into visual lines (as wrapped on screen). */
function domLines(txt: HTMLElement, scale: number): { text: string; y: number }[] {
  const node = txt.firstChild;
  const base = txt.getBoundingClientRect().top;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [{ text: txt.textContent ?? "", y: 0 }];
  const s = node.textContent ?? "";
  const r = document.createRange();
  const lines: { text: string; y: number }[] = [];
  let cur = "";
  let top: number | null = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      lines.push({ text: cur, y: top ?? 0 });
      cur = "";
      top = null;
      continue;
    }
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    const rect = r.getClientRects()[0];
    const t: number = rect ? Math.round((rect.top - base) / scale) : top ?? 0;
    if (top === null) top = t;
    else if (t > top + 2) {
      lines.push({ text: cur.replace(/\s+$/, ""), y: top });
      cur = "";
      top = t;
      if (s[i] === " ") continue;
    }
    cur += s[i];
  }
  lines.push({ text: cur, y: top ?? 0 });
  return lines;
}

export function exportSVG(app: App): string {
  const mv = app.mapView;
  if (app.view !== "map") app.setView("map");
  mv.render();
  const boxes = mv.boxes;
  const scale = mv.cam.s;
  const bb = bounds(boxes.values());
  const pad = 48;
  const W = Math.ceil(bb.maxX - bb.minX + pad * 2);
  const H = Math.ceil(bb.maxY - bb.minY + pad * 2);
  const ox = -bb.minX + pad,
    oy = -bb.minY + pad;
  const muted = cssVar("--muted") || "#6b7280";
  const canvas = cssVar("--canvas") || "#ffffff";
  const filled = app.mapStyle === "filled";
  const edgeCol = cssVar("--edge") || "#adb5bd";
  const color = (id: string) => hexColor(mv.colors.get(id) ?? "gray");

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}'>`);
  parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${muted}"/></marker></defs>`);
  parts.push(`<rect width="100%" height="100%" fill="${canvas}"/>`);
  parts.push(`<g transform="translate(${ox},${oy})">`);
  // Boundaries (behind everything)
  for (const bx of boundaryBoxes(app.top, boxes)) {
    const c = color(bx.id);
    parts.push(`<rect x="${bx.x}" y="${bx.y}" width="${bx.w}" height="${bx.h}" rx="10" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-opacity="0.75" stroke-width="1.5" stroke-dasharray="6 4"/>`);
    const tab = mv.edgesSvg().querySelector<SVGGElement>(`g.bnd-tab rect[x="${bx.x + 10}"]`)?.parentElement;
    if (bx.label && tab) {
      const r = tab.querySelector("rect")!,
        t = tab.querySelector("text")!;
      parts.push(`<rect x="${r.getAttribute("x")}" y="${r.getAttribute("y")}" width="${r.getAttribute("width")}" height="22" rx="6" fill="${c}"/><text x="${t.getAttribute("x")}" y="${t.getAttribute("y")}" font-size="12" font-weight="600" fill="#fff">${esc(t.textContent ?? "")}</text>`);
    }
  }
  for (const [id, b] of boxes) {
    if (!b.parent) continue;
    const p = boxes.get(b.parent)!;
    parts.push(`<path d="${edgePath(p, b)}" fill="none" stroke="${filled ? edgeCol : color(id)}" stroke-width="${b.depth === 1 && !filled ? 3 : 2}" stroke-linecap="round"/>`);
  }
  // Cross-links (same routes as on screen)
  const reqs = mv.linkRequests();
  routeLinks(boxes, reqs, mv.foldDots()).forEach((d) => {
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${muted}" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#arrow)"/>`);
  });
  mv.edgesSvg()
    .querySelectorAll<SVGTextElement>("text.xlabel")
    .forEach((t) =>
      parts.push(
        `<text x="${t.getAttribute("x")}" y="${t.getAttribute("y")}" text-anchor="middle" font-size="12" font-weight="500" fill="${muted}" stroke="${canvas}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(t.textContent ?? "")}</text>`,
      ),
    );
  for (const [id, b] of boxes) {
    const n = find(app.root, id)?.node;
    const el = mv.elementFor(id);
    if (!n || !el) continue;
    const cs = getComputedStyle(el);
    const fg = cs.color;
    // Shape: the same path the screen draws.
    const sp = el.querySelector<SVGPathElement>("svg.bg path.shape");
    const d = sp?.getAttribute("d");
    if (sp && d) {
      const ps = getComputedStyle(sp);
      const fill = sp.classList.contains("stroke-only") ? "none" : ps.fill;
      parts.push(`<path transform="translate(${b.x},${b.y})" d="${d}" fill="${fill}" stroke="${ps.stroke}" stroke-width="${ps.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    const fontSize = parseFloat(cs.fontSize);
    const weight = cs.fontWeight;
    const txt = el.querySelector<HTMLElement>(".txt")!;
    const lineH = parseFloat(getComputedStyle(txt).lineHeight) || fontSize * 1.3;
    // Checkbox
    const box = el.querySelector<HTMLElement>(".box");
    if (box && box.offsetParent && n.task) {
      const x = b.x + box.offsetLeft,
        y = b.y + box.offsetTop;
      parts.push(`<rect x="${x}" y="${y}" width="14" height="14" rx="3" fill="${n.task === "done" ? fg : "none"}" stroke="${fg}" stroke-width="1.6"/>`);
      if (n.task === "done") parts.push(`<path d="M${x + 3},${y + 7} l3,3 l5,-6" fill="none" stroke="${canvas}" stroke-width="2"/>`);
    }
    // Text
    const tx = b.x + txt.offsetLeft;
    const ty = b.y + txt.offsetTop;
    for (const l of domLines(txt, scale)) {
      parts.push(
        `<text x="${tx}" y="${ty + l.y + lineH / 2}" dominant-baseline="central" font-size="${fontSize}" font-weight="${weight}" fill="${fg}"${n.task === "done" ? ' text-decoration="line-through" fill-opacity="0.7"' : ""}>${esc(l.text)}</text>`,
      );
    }
    // Chips (checklist progress / attachments) and note dot
    const chip = el.querySelector<HTMLElement>(".chip");
    if (chip && chip.offsetParent && chip.textContent) {
      parts.push(`<text x="${b.x + chip.offsetLeft}" y="${b.y + chip.offsetTop + chip.offsetHeight / 2}" dominant-baseline="central" font-size="11" fill="${getComputedStyle(chip).color}">${esc(chip.textContent)}</text>`);
    }
    parts.push(...planParts(el, b.x, b.y));
    const dot = el.querySelector<HTMLElement>(".ndot");
    if (dot && dot.offsetParent) parts.push(`<circle cx="${b.x + dot.offsetLeft + 3}" cy="${b.y + dot.offsetTop + 3}" r="3" fill="${fg}" fill-opacity="0.8"/>`);
    if (n.collapsed && n.children.length) {
      const badge = el.querySelector<HTMLElement>(".badge");
      const bs = badge ? getComputedStyle(badge) : null;
      const cx = badge ? b.x + badge.offsetLeft + badge.offsetWidth / 2 : b.x + b.w + 14;
      const cy = badge ? b.y + badge.offsetTop + badge.offsetHeight / 2 : b.y + b.h / 2;
      parts.push(`<rect x="${cx - (badge?.offsetWidth ?? 20) / 2}" y="${cy - 9}" width="${badge?.offsetWidth ?? 20}" height="18" rx="9" fill="${bs?.backgroundColor ?? muted}"/>`);
      parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="${bs?.color ?? "#fff"}">${esc(badge?.textContent ?? "")}</text>`);
    }
    // Callout bubble
    const co = el.querySelector<HTMLElement>(".callout");
    if (co && !co.hidden && co.textContent) {
      const cst = getComputedStyle(co);
      const x = b.x + co.offsetLeft,
        y = b.y + co.offsetTop,
        w = co.offsetWidth,
        h = co.offsetHeight;
      parts.push(`<path d="M${x + 8},${y} H${x + w - 8} Q${x + w},${y} ${x + w},${y + 8} V${y + h - 8} Q${x + w},${y + h} ${x + w - 8},${y + h} H${x + 20} L${x + 15},${y + h + 6} L${x + 10},${y + h} H${x + 8} Q${x},${y + h} ${x},${y + h - 8} V${y + 8} Q${x},${y} ${x + 8},${y} Z" fill="${cst.backgroundColor}"/>`);
      const cl = co.firstChild ? domLines(co, scale) : [];
      const lh = parseFloat(cst.lineHeight) || 16;
      for (const l of cl) parts.push(`<text x="${x + 9}" y="${y + l.y + lh / 2}" dominant-baseline="central" font-size="12" font-weight="500" fill="${cst.color}">${esc(l.text)}</text>`);
    }
  }
  parts.push(`</g></svg>`);
  return parts.join("\n");
}

export async function svgToCanvas(svg: string, scale: number): Promise<{ canvas: HTMLCanvasElement; w: number; h: number }> {
  const m = svg.match(/width="(\d+)" height="(\d+)"/)!;
  const w = Number(m[1]),
    h = Number(m[2]);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas");
  const s = Math.min(scale, 16000 / Math.max(w, h));
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.drawImage(img, 0, 0);
  return { canvas: c, w, h };
}

export async function exportPNG(app: App, scale = 2): Promise<Uint8Array> {
  const { canvas } = await svgToCanvas(exportSVG(app), scale);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** One-page PDF sized to the map. Rendered at high resolution so every script and emoji prints correctly. */
export async function exportPDF(app: App): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const { canvas, w, h } = await svgToCanvas(exportSVG(app), 3);
  const doc = new jsPDF({ orientation: w >= h ? "landscape" : "portrait", unit: "pt", format: [w, h], compress: true });
  doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, w, h, undefined, "FAST");
  doc.setProperties({ title: app.top.text, creator: "Ramify" });
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Standalone web page: the map picture followed by the full text as a document. */
export function exportHTML(app: App): string {
  const svg = exportSVG(app);
  const body = new Marked({ gfm: true }).parse(headingsMarkdown(app.top), { async: false }) as string;
  const title = esc(app.top.text || "Map");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{margin:0;font:16px/1.6 ${FONT};color:#1f2937;background:#fff}
.map{overflow:auto;border-bottom:1px solid #e5e7eb;background:#f6f6f4}
.map svg{display:block;margin:0 auto;max-width:none}
main{max-width:760px;margin:0 auto;padding:32px 24px 80px}
h1{font-size:2em}h2{margin-top:1.6em}
footer{color:#888;font-size:13px;text-align:center;padding:20px}
</style></head><body>
<div class="map">${svg}</div>
<main>${body}</main>
<footer>Made with Ramify</footer>
</body></html>
`;
}

export function exportJSON(top: MapNode): string {
  const conv = (n: MapNode): any => {
    const o: any = { text: n.text };
    if (n.note) o.note = n.note;
    if (n.task) o.task = n.task;
    if (n.color) o.color = n.color;
    if (n.shape) o.shape = n.shape;
    if (n.collapsed) o.collapsed = true;
    if (n.anchor) o.anchor = n.anchor;
    if (n.links?.length) o.links = n.links;
    if (n.children.length) o.children = n.children.map(conv);
    return o;
  };
  return JSON.stringify({ format: "ramify", version: 1, root: conv(top) }, null, 2) + "\n";
}

export function exportText(top: MapNode): string {
  const out: string[] = [];
  const rec = (n: MapNode, d: number) => {
    const box = n.task === "todo" ? "[ ] " : n.task === "done" ? "[x] " : "";
    out.push("\t".repeat(d) + box + n.text.replace(/\n/g, " "));
    n.children.forEach((c) => rec(c, d + 1));
  };
  rec(top, 0);
  return out.join("\n") + "\n";
}

/** Priority badge, progress bar, dates, assignee and labels, as drawn on screen. */
function planParts(el: HTMLElement, bx: number, by: number): string[] {
  const out: string[] = [];
  const at = (e: HTMLElement) => ({ x: bx + e.offsetLeft, y: by + e.offsetTop, w: e.offsetWidth, h: e.offsetHeight });
  const vis = (e: HTMLElement | null): e is HTMLElement => !!e && !!e.offsetParent;
  const txt = (e: HTMLElement, size: number, weight = "400") => {
    const r = at(e);
    const cs = getComputedStyle(e);
    const pl = parseFloat(cs.paddingLeft) || 0;
    return `<text x="${r.x + pl}" y="${r.y + r.h / 2}" dominant-baseline="central" font-size="${size}" font-weight="${weight}" fill="${cs.color}">${esc(e.textContent ?? "")}</text>`;
  };
  const pill = (e: HTMLElement) => {
    const r = at(e);
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor;
    const border = cs.borderTopWidth !== "0px" ? ` stroke="${cs.borderTopColor}"` : "";
    if (bg && bg !== "rgba(0, 0, 0, 0)") out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${Math.min(9, r.h / 2)}" fill="${bg}"${border}/>`);
    else if (border) out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="5" fill="none"${border}/>`);
  };
  const pri = el.querySelector<HTMLElement>(".pri");
  if (vis(pri)) {
    pill(pri);
    const r = at(pri);
    out.push(`<text x="${r.x + r.w / 2}" y="${r.y + r.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#fff">${esc(pri.textContent ?? "")}</text>`);
  }
  el.querySelectorAll<HTMLElement>(".pbar").forEach((bar) => {
    if (!vis(bar)) return;
    const r = at(bar);
    const col = getComputedStyle(bar).color;
    const fill = bar.querySelector<HTMLElement>("i");
    out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3" fill="${col}" fill-opacity="0.18"/>`);
    if (fill) out.push(`<rect x="${r.x}" y="${r.y}" width="${fill.offsetWidth}" height="${r.h}" rx="3" fill="${col}" fill-opacity="0.75"/>`);
  });
  el.querySelectorAll<HTMLElement>(".ppct, .pdates").forEach((e) => vis(e) && out.push(txt(e, 11.5)));
  el.querySelectorAll<HTMLElement>(".pdays").forEach((e) => {
    if (!vis(e)) return;
    const r = at(e);
    out.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="8" fill="${getComputedStyle(e).color}" fill-opacity="0.12"/>`);
    out.push(txt(e, 11.5));
  });
  el.querySelectorAll<HTMLElement>(".pwho").forEach((e) => {
    if (!vis(e)) return;
    const b = e.querySelector<HTMLElement>("b");
    const r = at(e);
    if (b) out.push(`<circle cx="${r.x + 8}" cy="${r.y + r.h / 2}" r="8" fill="#6e56cf"/><text x="${r.x + 8}" y="${r.y + r.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="9.5" fill="#fff">${esc(b.textContent ?? "")}</text>`);
    out.push(`<text x="${r.x + 21}" y="${r.y + r.h / 2}" dominant-baseline="central" font-size="11.5" fill="${getComputedStyle(e).color}">${esc((e.textContent ?? "").slice(b?.textContent?.length ?? 0))}</text>`);
  });
  el.querySelectorAll<HTMLElement>(".labels span").forEach((e) => {
    if (!vis(e)) return;
    pill(e);
    out.push(txt(e, 11));
  });
  return out;
}
