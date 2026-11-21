import type { App } from "./app";
import { edgePath, bounds, Box } from "./layout";
import { MapNode, find } from "./model";
import { hexColor } from "./colors";


const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let ctx: CanvasRenderingContext2D | null = null;
function wrap(text: string, font: string, maxW: number): string[] {
  ctx ??= document.createElement("canvas").getContext("2d")!;
  ctx.font = font;
  const out: string[] = [];
  for (const para of (text || " ").split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const t = line + w;
      if (ctx.measureText(t).width > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function exportSVG(app: App): string {
  const mv = app.mapView;
  if (app.view !== "map") {
    app.setView("map");
  }
  mv.relayout();
  const boxes = mv.boxes;
  const bb = bounds(boxes.values());
  const pad = 40;
  const W = Math.ceil(bb.maxX - bb.minX + pad * 2);
  const H = Math.ceil(bb.maxY - bb.minY + pad * 2);
  const ox = -bb.minX + pad,
    oy = -bb.minY + pad;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}'>`);
  parts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  parts.push(`<g transform="translate(${ox},${oy})">`);
  const color = (id: string) => hexColor(mv.colors.get(id) ?? "gray");
  for (const [id, b] of boxes) {
    if (!b.parent) continue;
    const p = boxes.get(b.parent)!;
    parts.push(`<path d="${edgePath(p, b)}" fill="none" stroke="${color(id)}" stroke-width="${b.depth === 1 ? 3 : 2}" stroke-linecap="round"/>`);
  }
  for (const [id, b] of boxes) {
    const n = find(app.root, id)?.node;
    if (n) parts.push(nodeSVG(n, b, color(id), !b.parent));
  }
  parts.push(`</g></svg>`);
  return parts.join("\n");
}

function nodeSVG(n: MapNode, b: Box, col: string, isRoot: boolean): string {
  const out: string[] = [];
  const d1 = b.depth === 1;
  const size = isRoot ? 20 : d1 ? 15 : 14;
  const weight = isRoot ? 700 : d1 ? 600 : 400;
  const padX = isRoot ? 18 : d1 ? 12 : 6;
  const lineH = Math.round(size * 1.3);
  const font = `${weight} ${size}px ${FONT}`;
  const boxW = n.task ? 20 : 0;
  const border = d1 ? 4 : 0;
  // Box width = text + padding (+ border, checkbox, note dot). Small tolerance avoids false wraps.
  const lines = wrap(n.text, font, b.w - padX * 2 - border - boxW - (n.note.trim() ? 12 : 0) + 3);
  if (isRoot) out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(b.h / 2, 22)}" fill="${n.color ? col : "#1f2937"}"/>`);
  else if (d1) out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="10" fill="#ffffff" stroke="${col}" stroke-width="2"/>`);
  else out.push(`<line x1="${b.x + 2}" y1="${b.y + b.h - 1}" x2="${b.x + b.w - 2}" y2="${b.y + b.h - 1}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`);
  const textColor = isRoot ? "#ffffff" : n.task === "done" ? "#868e96" : "#1f2937";
  let tx = b.x + padX + border / 2;
  const blockH = lines.length * lineH;
  const top = b.y + (b.h - blockH) / 2;
  if (n.task) {
    const cy = top + lineH / 2;
    out.push(`<rect x="${tx}" y="${cy - 7}" width="14" height="14" rx="3" fill="${n.task === "done" ? col : "none"}" stroke="${col}" stroke-width="1.6"/>`);
    if (n.task === "done") out.push(`<path d="M${tx + 3},${cy} l3,3 l5,-6" fill="none" stroke="#fff" stroke-width="2"/>`);
    tx += boxW;
  }
  lines.forEach((l, i) => {
    const y = top + i * lineH + lineH / 2;
    out.push(
      `<text x="${tx}" y="${y}" dominant-baseline="central" font-size="${size}" font-weight="${weight}" fill="${textColor}"${n.task === "done" ? ' text-decoration="line-through"' : ""}>${esc(l)}</text>`,
    );
  });
  if (n.note.trim()) out.push(`<circle cx="${b.x + b.w - padX + 2}" cy="${top + lineH / 2}" r="3" fill="${isRoot ? "#fff" : col}"/>`);
  if (n.collapsed && n.children.length) {
    const cx = b.side === 1 ? b.x + b.w + 12 : b.x - 12;
    out.push(`<circle cx="${cx}" cy="${b.y + b.h / 2}" r="9" fill="${col}"/>`);
    out.push(`<text x="${cx}" y="${b.y + b.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="#fff">${countDesc(n)}</text>`);
  }
  return out.join("");
}

function countDesc(n: MapNode): number {
  let c = 0;
  const rec = (x: MapNode) => x.children.forEach((k) => (c++, rec(k)));
  rec(n);
  return c;
}

export async function exportPNG(app: App, scale = 2): Promise<Uint8Array> {
  const svg = exportSVG(app);
  const m = svg.match(/width="(\d+)" height="(\d+)"/)!;
  const w = Number(m[1]),
    h = Number(m[2]);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const c = document.createElement("canvas");
  // Stay under common canvas limits.
  const s = Math.min(scale, 16000 / Math.max(w, h));
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.drawImage(img, 0, 0);
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
