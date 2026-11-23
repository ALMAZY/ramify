// 16 themes + "system" (follows the OS light/dark setting via styles.css).
// Each theme sets the CSS variables used across the app and in exports.

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  bg: string;
  canvas: string;
  panel: string;
  text: string;
  muted: string;
  line: string;
  sel: string;
  rootBg: string;
  rootFg: string;
  nodeBg: string;
  kbdBg: string;
  branches: [string, string, string, string, string, string, string, string];
}

const LIGHT_B: Theme["branches"] = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#e03131", "#5f3dc4"];
const DARK_B: Theme["branches"] = ["#ff922b", "#4dabf7", "#51cf66", "#da77f2", "#fcc419", "#3bc9db", "#ff6b6b", "#9775fa"];

export const THEMES: Theme[] = [
  { id: "graphite", name: "Graphite", dark: true, bg: "#1c1c1f", canvas: "#19191c", panel: "#232326", text: "#ececf1", muted: "#8d8f98", line: "#2e2f35", sel: "#5b8cff", rootBg: "#3a4150", rootFg: "#ffffff", nodeBg: "#2b2d33", kbdBg: "#2a2b31", branches: ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#ef4444", "#eab308", "#14b8a6", "#ec4899"] },
  { id: "light", name: "Light", dark: false, bg: "#fbfbfa", canvas: "#f6f6f4", panel: "#ffffff", text: "#1f2937", muted: "#6b7280", line: "#e5e7eb", sel: "#4c6ef5", rootBg: "#1f2937", rootFg: "#ffffff", nodeBg: "#ffffff", kbdBg: "#f1f3f5", branches: LIGHT_B },
  { id: "dark", name: "Dark", dark: true, bg: "#17181b", canvas: "#1c1d21", panel: "#212226", text: "#e6e6e6", muted: "#9a9ca3", line: "#2f3137", sel: "#748ffc", rootBg: "#e6e6e6", rootFg: "#17181b", nodeBg: "#26272c", kbdBg: "#2c2d33", branches: DARK_B },
  { id: "paper", name: "Paper", dark: false, bg: "#ffffff", canvas: "#ffffff", panel: "#fafafa", text: "#111111", muted: "#777777", line: "#ececec", sel: "#111111", rootBg: "#111111", rootFg: "#ffffff", nodeBg: "#ffffff", kbdBg: "#f4f4f4", branches: ["#222222", "#444444", "#666666", "#333333", "#555555", "#777777", "#2b2b2b", "#4a4a4a"] },
  { id: "sepia", name: "Sepia", dark: false, bg: "#f4ecd8", canvas: "#f1e7cf", panel: "#f8f1e0", text: "#433422", muted: "#8a7558", line: "#e2d4b4", sel: "#a0522d", rootBg: "#5b4636", rootFg: "#f8f1e0", nodeBg: "#fbf5e6", kbdBg: "#ece0c2", branches: ["#b5651d", "#4f6d7a", "#6b8e23", "#8b4f75", "#c08a1e", "#3f7f76", "#a33b2f", "#5d4b8a"] },
  { id: "solarized-light", name: "Solarized Light", dark: false, bg: "#fdf6e3", canvas: "#fdf6e3", panel: "#eee8d5", text: "#586e75", muted: "#93a1a1", line: "#e4dcc5", sel: "#268bd2", rootBg: "#073642", rootFg: "#fdf6e3", nodeBg: "#fffaea", kbdBg: "#eee8d5", branches: ["#cb4b16", "#268bd2", "#859900", "#d33682", "#b58900", "#2aa198", "#dc322f", "#6c71c4"] },
  { id: "solarized-dark", name: "Solarized Dark", dark: true, bg: "#002b36", canvas: "#002b36", panel: "#073642", text: "#93a1a1", muted: "#657b83", line: "#0e4351", sel: "#268bd2", rootBg: "#eee8d5", rootFg: "#002b36", nodeBg: "#073642", kbdBg: "#0a3d4a", branches: ["#cb4b16", "#268bd2", "#859900", "#d33682", "#b58900", "#2aa198", "#dc322f", "#6c71c4"] },
  { id: "nord", name: "Nord", dark: true, bg: "#2e3440", canvas: "#2e3440", panel: "#3b4252", text: "#eceff4", muted: "#a3acbd", line: "#434c5e", sel: "#88c0d0", rootBg: "#88c0d0", rootFg: "#2e3440", nodeBg: "#3b4252", kbdBg: "#434c5e", branches: ["#d08770", "#81a1c1", "#a3be8c", "#b48ead", "#ebcb8b", "#8fbcbb", "#bf616a", "#5e81ac"] },
  { id: "dracula", name: "Dracula", dark: true, bg: "#282a36", canvas: "#282a36", panel: "#21222c", text: "#f8f8f2", muted: "#9ea8d0", line: "#3a3d4f", sel: "#bd93f9", rootBg: "#bd93f9", rootFg: "#282a36", nodeBg: "#343746", kbdBg: "#3a3d4f", branches: ["#ffb86c", "#8be9fd", "#50fa7b", "#ff79c6", "#f1fa8c", "#6be5c5", "#ff5555", "#bd93f9"] },
  { id: "gruvbox-light", name: "Gruvbox Light", dark: false, bg: "#fbf1c7", canvas: "#fbf1c7", panel: "#f2e5bc", text: "#3c3836", muted: "#7c6f64", line: "#e6d8ad", sel: "#076678", rootBg: "#3c3836", rootFg: "#fbf1c7", nodeBg: "#fdf6d8", kbdBg: "#ebdbb2", branches: ["#af3a03", "#076678", "#79740e", "#8f3f71", "#b57614", "#427b58", "#9d0006", "#5b4a9b"] },
  { id: "gruvbox-dark", name: "Gruvbox Dark", dark: true, bg: "#282828", canvas: "#282828", panel: "#32302f", text: "#ebdbb2", muted: "#a89984", line: "#3c3836", sel: "#83a598", rootBg: "#ebdbb2", rootFg: "#282828", nodeBg: "#32302f", kbdBg: "#3c3836", branches: ["#fe8019", "#83a598", "#b8bb26", "#d3869b", "#fabd2f", "#8ec07c", "#fb4934", "#b16286"] },
  { id: "one-dark", name: "One Dark", dark: true, bg: "#282c34", canvas: "#282c34", panel: "#21252b", text: "#dcdfe4", muted: "#8b93a1", line: "#353b45", sel: "#61afef", rootBg: "#61afef", rootFg: "#1e2228", nodeBg: "#2f343e", kbdBg: "#353b45", branches: ["#d19a66", "#61afef", "#98c379", "#c678dd", "#e5c07b", "#56b6c2", "#e06c75", "#a48bf0"] },
  { id: "monokai", name: "Monokai", dark: true, bg: "#272822", canvas: "#272822", panel: "#1f201b", text: "#f8f8f2", muted: "#a59f85", line: "#3e3d32", sel: "#a6e22e", rootBg: "#f8f8f2", rootFg: "#272822", nodeBg: "#33342b", kbdBg: "#3e3d32", branches: ["#fd971f", "#66d9ef", "#a6e22e", "#f92672", "#e6db74", "#78dce8", "#ff6188", "#ae81ff"] },
  { id: "latte", name: "Catppuccin Latte", dark: false, bg: "#eff1f5", canvas: "#eff1f5", panel: "#e6e9ef", text: "#4c4f69", muted: "#8c8fa1", line: "#dce0e8", sel: "#8839ef", rootBg: "#4c4f69", rootFg: "#eff1f5", nodeBg: "#ffffff", kbdBg: "#dce0e8", branches: ["#fe640b", "#1e66f5", "#40a02b", "#ea76cb", "#df8e1d", "#179299", "#d20f39", "#8839ef"] },
  { id: "mocha", name: "Catppuccin Mocha", dark: true, bg: "#1e1e2e", canvas: "#1e1e2e", panel: "#181825", text: "#cdd6f4", muted: "#9399b2", line: "#313244", sel: "#cba6f7", rootBg: "#cba6f7", rootFg: "#1e1e2e", nodeBg: "#313244", kbdBg: "#313244", branches: ["#fab387", "#89b4fa", "#a6e3a1", "#f5c2e7", "#f9e2af", "#94e2d5", "#f38ba8", "#b4befe"] },
  { id: "rose-pine", name: "Rosé Pine", dark: true, bg: "#191724", canvas: "#191724", panel: "#1f1d2e", text: "#e0def4", muted: "#908caa", line: "#26233a", sel: "#c4a7e7", rootBg: "#ebbcba", rootFg: "#191724", nodeBg: "#26233a", kbdBg: "#26233a", branches: ["#ebbcba", "#9ccfd8", "#31748f", "#c4a7e7", "#f6c177", "#56949f", "#eb6f92", "#907aa9"] },
  { id: "contrast", name: "High Contrast", dark: true, bg: "#000000", canvas: "#000000", panel: "#0a0a0a", text: "#ffffff", muted: "#cccccc", line: "#555555", sel: "#ffff00", rootBg: "#ffffff", rootFg: "#000000", nodeBg: "#000000", kbdBg: "#222222", branches: ["#ff9900", "#00ccff", "#33ff66", "#ff66ff", "#ffff00", "#00ffcc", "#ff3333", "#aa88ff"] },
];

const VARS = ["--node-fill", "--edge", "--fold-dot", "--callout-bg", "--callout-fg", "--b8", "--b9", "--b10", "--bg", "--canvas", "--panel", "--text", "--muted", "--line", "--sel", "--sel-soft", "--root-bg", "--root-fg", "--node-bg", "--kbd-bg", "--shadow", "--b0", "--b1", "--b2", "--b3", "--b4", "--b5", "--b6", "--b7"];

/** Mix two hex colours: a·t + b·(1−t). */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * t + ((pb >> sh) & 255) * (1 - t));
  return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
}

function soft(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Apply a theme id ("system" = follow the OS). */
export function applyTheme(id: string) {
  const el = document.documentElement;
  const t = THEMES.find((x) => x.id === id);
  for (const v of VARS) el.style.removeProperty(v);
  if (!t) {
    delete el.dataset.theme;
    el.style.removeProperty("color-scheme");
    return;
  }
  el.dataset.theme = t.dark ? "dark" : "light";
  const set = (k: string, v: string) => el.style.setProperty(k, v);
  set("--bg", t.bg);
  set("--canvas", t.canvas);
  set("--panel", t.panel);
  set("--text", t.text);
  set("--muted", t.muted);
  set("--line", t.line);
  set("--sel", t.sel);
  set("--sel-soft", soft(t.sel, t.dark ? 0.22 : 0.14));
  set("--root-bg", t.rootBg);
  set("--root-fg", t.rootFg);
  set("--node-bg", t.nodeBg);
  set("--kbd-bg", t.kbdBg);
  set("--shadow", t.dark ? "0 1px 2px rgba(0,0,0,.4), 0 6px 20px rgba(0,0,0,.3)" : "0 1px 2px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.06)");
  t.branches.forEach((c, i) => set(`--b${i}`, c));
  // Derived colours: filled sub-topics, branch lines, fold dots, callouts.
  set("--node-fill", mix(t.text, t.canvas, t.dark ? 0.17 : 0.09));
  set("--edge", mix(t.text, t.canvas, t.dark ? 0.38 : 0.32));
  set("--fold-dot", mix(t.text, t.canvas, 0.85));
  set("--callout-bg", t.dark ? mix("#ffd43b", t.canvas, 0.28) : mix("#ffd43b", "#ffffff", 0.32));
  set("--callout-fg", t.dark ? "#ffec99" : "#5c3c00");
  set("--b8", mix(t.text, t.canvas, 0.5));
  set("--b9", t.dark ? "#f06595" : "#d6336c");
  set("--b10", t.dark ? "#3bc9db" : "#1098ad");
  el.style.setProperty("color-scheme", t.dark ? "dark" : "light");
}

/** Current value of a CSS variable (resolved for the active theme). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
