// Small dropdown menu anchored to a button. Keyboard: ↑ ↓ Enter Esc.

import { escapeHtml } from "./app";

export interface MenuItem {
  label: string;
  keys?: string;
  icon?: string; // SVG markup
  run: () => unknown;
  sep?: boolean; // draw a line above this item
}

let open: HTMLElement | null = null;

export function closeMenu() {
  open?.remove();
  open = null;
}

export function showMenu(anchor: HTMLElement, items: MenuItem[], onClose?: () => void, align: "left" | "right" = "left") {
  closeMenu();
  const el = document.createElement("div");
  el.className = "menu";
  el.innerHTML = items
    .map(
      (it, i) =>
        `${it.sep ? '<div class="menu-sep"></div>' : ""}<button data-i="${i}" class="menu-item">${it.icon ?? ""}<span>${escapeHtml(it.label)}</span>${it.keys ? `<kbd>${escapeHtml(it.keys)}</kbd>` : ""}</button>`,
    )
    .join("");
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  // Open below the anchor; if it doesn't fit (e.g. the Settings button at the
  // bottom of the sidebar), open above it; keep it inside the window either way.
  const h = el.offsetHeight;
  const below = r.bottom + 6;
  const top = below + h <= window.innerHeight - 8 ? below : r.top - 6 - h;
  el.style.top = Math.max(8, Math.min(top, window.innerHeight - 8 - h)) + "px";
  if (align === "left") el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - el.offsetWidth)) + "px";
  else el.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  open = el;
  const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button.menu-item"));
  let idx = 0;
  const focus = () => buttons[idx]?.focus();
  focus();
  const done = (run?: () => unknown) => {
    cleanup();
    closeMenu();
    if (run) void Promise.resolve(run());
    else onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    e.stopPropagation();
    if (e.key === "ArrowDown") (idx = (idx + 1) % buttons.length), focus(), e.preventDefault();
    else if (e.key === "ArrowUp") (idx = (idx - 1 + buttons.length) % buttons.length), focus(), e.preventDefault();
    else if (e.key === "Escape") e.preventDefault(), done();
    else if (e.key === "Enter") e.preventDefault(), done(items[idx].run);
  };
  const onDown = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && e.target !== anchor) done();
  };
  const cleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDown, true);
  buttons.forEach((b, i) => {
    b.addEventListener("mouseenter", () => ((idx = i), focus()));
    b.addEventListener("click", () => done(items[i].run));
  });
}
