// Rich notes: Markdown rendering (sanitised), clickable checklists,
// attachments shown inline (images) or as links that open in the default app.

import { Marked } from "marked";
import DOMPurify from "dompurify";
import type { Store } from "./storage";
import { resolveLink, isImage, mimeFor, isDesktop } from "./storage";

const md = new Marked({ gfm: true, breaks: true });

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

/** Count checklist items in a note. */
export function taskStats(note: string): { done: number; total: number } {
  let done = 0,
    total = 0;
  for (const l of note.split("\n")) {
    const m = l.match(TASK_LINE);
    if (m) {
      total++;
      if (m[2] !== " ") done++;
    }
  }
  return { done, total };
}

/** Toggle the n-th checklist item in a note. */
export function toggleTask(note: string, index: number): string {
  let i = -1;
  return note
    .split("\n")
    .map((l) => {
      const m = l.match(TASK_LINE);
      if (!m) return l;
      i++;
      if (i !== index) return l;
      return l.replace(TASK_LINE, `$1[${m[2] === " " ? "x" : " "}]`);
    })
    .join("\n");
}

/** Attachment / image links in a note (paths as written). */
export function noteLinks(note: string): { text: string; href: string; image: boolean }[] {
  const out: { text: string; href: string; image: boolean }[] = [];
  const re = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(note))) out.push({ text: m[2], href: m[3], image: m[1] === "!" || isImage(m[3]) });
  return out.filter((l) => !/^[a-z]+:/i.test(l.href));
}

const blobCache = new Map<string, string>();

export async function attachmentURL(store: Store, rel: string): Promise<string> {
  const hit = blobCache.get(rel);
  if (hit) return hit;
  const bytes = await store.readBytes(rel);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(rel) }));
  blobCache.set(rel, url);
  return url;
}

export async function openExternal(url: string) {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url });
  } else window.open(url, "_blank", "noopener");
}

/**
 * Render a note into `el`. `mapRel` is the map's path (to resolve relative links).
 * `onToggle(i)` is called when the i-th checkbox is clicked.
 */
export function renderNote(el: HTMLElement, note: string, store: Store, mapRel: string, onToggle: (i: number) => void) {
  const html = md.parse(note || "", { async: false }) as string;
  el.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  // Checklists: enable and wire the boxes.
  el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb, i) => {
    cb.disabled = false;
    cb.closest("li")?.classList.add("task-item");
    cb.addEventListener("click", (e) => {
      e.preventDefault();
      onToggle(i);
    });
  });
  // Images from attachments.
  el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const rel = resolveLink(mapRel, src);
    if (!rel) return;
    img.removeAttribute("src");
    img.dataset.rel = rel;
    img.title = rel.split("/").pop() ?? "";
    attachmentURL(store, rel)
      .then((u) => (img.src = u))
      .catch(() => img.replaceWith(Object.assign(document.createElement("span"), { className: "missing", textContent: `Missing: ${src}` })));
    img.addEventListener("click", () => void store.openFile(rel));
  });
  // Links: attachments open in the default app, web links in the browser.
  el.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = a.getAttribute("href")!;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (/^(https?:|mailto:)/i.test(href)) void openExternal(href);
      else {
        const rel = resolveLink(mapRel, href);
        if (rel) void store.openFile(rel).catch((err) => alert(String(err)));
      }
    });
    if (!/^(https?:|mailto:)/i.test(href)) a.classList.add("attachment");
  });
}
