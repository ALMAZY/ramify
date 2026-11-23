// Topic shapes. Every shape is an SVG path drawn behind the topic text, so the
// same geometry is used on screen and in exports.

export const SHAPE_LIST = [
  { id: "rect", name: "Rectangle" },
  { id: "rounded", name: "Rounded" },
  { id: "pill", name: "Pill" },
  { id: "line", name: "Underline" },
  { id: "plain", name: "Text only" },
  { id: "diamond", name: "Diamond" },
  { id: "hexagon", name: "Hexagon" },
  { id: "parallelogram", name: "Slanted" },
  { id: "tag", name: "Arrow tag" },
  { id: "frame", name: "Outline box" },
  { id: "cloud", name: "Cloud" },
  { id: "ellipse", name: "Ellipse" },
  { id: "bubble", name: "Speech bubble" },
  { id: "ticket", name: "Ticket" },
  { id: "banner", name: "Banner" },
] as const;

export type ShapeId = (typeof SHAPE_LIST)[number]["id"];
export const SHAPE_IDS = SHAPE_LIST.map((s) => s.id) as ShapeId[];

/** Older names still found in files. */
export const SHAPE_ALIASES: Record<string, ShapeId> = { box: "rounded" };

/** Shapes drawn only as a line (no fill). */
export const STROKE_ONLY = new Set<ShapeId>(["line", "frame"]);

const f = (v: number) => Math.round(v * 10) / 10;

function roundRect(w: number, h: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
}

/** Bumpy outline: a bulge along every stretch of every side. */
function cloud(w: number, h: number): string {
  const b = 7;
  const nx = Math.max(2, Math.round(w / 26)),
    ny = Math.max(1, Math.round(h / 22));
  const sx = w / nx,
    sy = h / ny;
  let d = `M0,0`;
  for (let i = 0; i < nx; i++) d += ` Q${f(sx * i + sx / 2)},${-b} ${f(sx * (i + 1))},0`;
  for (let i = 0; i < ny; i++) d += ` Q${f(w + b)},${f(sy * i + sy / 2)} ${f(w)},${f(sy * (i + 1))}`;
  for (let i = nx - 1; i >= 0; i--) d += ` Q${f(sx * i + sx / 2)},${f(h + b)} ${f(sx * i)},${f(h)}`;
  for (let i = ny - 1; i >= 0; i--) d += ` Q${-b},${f(sy * i + sy / 2)} 0,${f(sy * i)}`;
  return d + " Z";
}

/** SVG path for a shape of size w × h (origin at the top-left of the topic). */
export function shapePath(shape: ShapeId, w: number, h: number, root = false): string {
  switch (shape) {
    case "rect":
      return roundRect(w, h, 2);
    case "rounded":
      return roundRect(w, h, root ? 14 : 9);
    case "pill":
      return roundRect(w, h, h / 2);
    case "frame":
      return roundRect(w, h, 3);
    case "line":
      return `M1,${f(h - 1)} H${f(w - 1)}`;
    case "plain":
      return "";
    case "ellipse":
      return `M0,${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 0 ${f(w)},${f(h / 2)} A${f(w / 2)},${f(h / 2)} 0 1 0 0,${f(h / 2)} Z`;
    case "diamond":
      return `M${f(w / 2)},0 L${f(w)},${f(h / 2)} L${f(w / 2)},${f(h)} L0,${f(h / 2)} Z`;
    case "hexagon": {
      const k = Math.min(16, h / 2);
      return `M${f(k)},0 H${f(w - k)} L${f(w)},${f(h / 2)} L${f(w - k)},${f(h)} H${f(k)} L0,${f(h / 2)} Z`;
    }
    case "parallelogram": {
      const k = Math.min(14, w / 4);
      return `M${f(k)},0 H${f(w)} L${f(w - k)},${f(h)} H0 Z`;
    }
    case "tag": {
      const k = Math.min(16, h / 2);
      return `M0,0 H${f(w - k)} L${f(w)},${f(h / 2)} L${f(w - k)},${f(h)} H0 Z`;
    }
    case "banner": {
      const k = Math.min(10, w / 6);
      return `M0,0 H${f(w)} L${f(w - k)},${f(h / 2)} L${f(w)},${f(h)} H0 L${f(k)},${f(h / 2)} Z`;
    }
    case "ticket": {
      const r = Math.min(7, h / 4);
      return `M0,0 H${f(w)} V${f(h / 2 - r)} A${f(r)},${f(r)} 0 0 0 ${f(w)},${f(h / 2 + r)} V${f(h)} H0 V${f(h / 2 + r)} A${f(r)},${f(r)} 0 0 0 0,${f(h / 2 - r)} Z`;
    }
    case "bubble": {
      const t = 8; // tail height
      const bh = h - t;
      const r = Math.min(9, bh / 2);
      const tx = Math.min(22, w / 3);
      return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(bh - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(bh)} H${f(tx + 12)} L${f(tx)},${f(h)} L${f(tx + 2)},${f(bh)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(bh - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
    }
    case "cloud":
      return cloud(w, h);
  }
}

/** Small preview path for the shape picker (24 × 16 box). */
export function shapeIcon(shape: ShapeId): string {
  if (shape === "plain") return `<text x="12" y="12.5" text-anchor="middle" font-size="10" font-weight="600" fill="currentColor" stroke="none">Aa</text>`;
  const d = shapePath(shape, 22, shape === "bubble" ? 16 : 14);
  const fill = STROKE_ONLY.has(shape) ? "none" : "currentColor";
  return `<path d="${d}" transform="translate(1,1)" fill="${fill}" fill-opacity="${shape === "frame" || shape === "line" ? 0 : 0.18}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`;
}
