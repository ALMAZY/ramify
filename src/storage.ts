// Storage backends. The desktop app (Tauri) reads and writes .md files in a
// folder you choose (with sub-folders). In a plain browser (dev / demo) maps
// live in localStorage.

export interface MapEntry {
  name: string; // path relative to the maps folder, "/" separators, incl. ".md"
  mtime: number;
}

export interface Tree {
  files: MapEntry[];
  folders: string[];
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface ImportedFile {
  name: string;
  text: string;
  bytes: Uint8Array;
}

export interface HttpResult {
  status: number;
  body: string;
}

export const ATTACH_DIR = "attachments";

export interface Store {
  kind: "desktop" | "browser";
  hasFolder(): boolean;
  folderLabel(): string;
  chooseFolder(): Promise<boolean>;
  list(): Promise<Tree>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
  makeFolder(rel: string): Promise<void>;
  /** Ask for files and copy them into the attachments folder. Returns paths relative to the maps folder. */
  pickAttachments(): Promise<string[]>;
  /** Copy files given by absolute path (drag and drop) into attachments. */
  attachPaths(paths: string[]): Promise<string[]>;
  readBytes(rel: string): Promise<Uint8Array>;
  openFile(rel: string): Promise<void>;
  exportFile(defaultName: string, data: string | Uint8Array, filter: FileFilter): Promise<string | null>;
  importFile(filters: FileFilter[]): Promise<ImportedFile | null>;
  http(url: string, method: string, headers: [string, string][], body?: string): Promise<HttpResult>;
}

export const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const FOLDER_KEY = "lm:folder";

export function toBase64(data: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

class DesktopStore implements Store {
  kind = "desktop" as const;
  private folder: string | null = localStorage.getItem(FOLDER_KEY);
  private async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  private sep() {
    return this.folder && this.folder.includes("\\") && !this.folder.includes("/") ? "\\" : "/";
  }
  path(rel: string) {
    if (!this.folder) throw new Error("No folder chosen");
    const sep = this.sep();
    return this.folder.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
  }
  hasFolder() {
    return !!this.folder;
  }
  folderLabel() {
    if (!this.folder) return "Choose folder…";
    const parts = this.folder.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? this.folder;
  }
  async chooseFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, multiple: false, title: "Folder for your maps" });
    if (typeof dir !== "string") return false;
    this.folder = dir;
    localStorage.setItem(FOLDER_KEY, dir);
    return true;
  }
  async list() {
    if (!this.folder) return { files: [], folders: [] };
    return this.invoke<Tree>("list_maps", { dir: this.folder });
  }
  read(name: string) {
    return this.invoke<string>("read_text", { path: this.path(name) });
  }
  write(name: string, text: string) {
    return this.invoke<void>("write_text", { path: this.path(name), contents: text });
  }
  rename(from: string, to: string) {
    return this.invoke<void>("rename_file", { from: this.path(from), to: this.path(to) });
  }
  remove(name: string) {
    return this.invoke<void>("trash_file", { path: this.path(name) });
  }
  makeFolder(rel: string) {
    return this.invoke<void>("make_dir", { path: this.path(rel) });
  }
  async pickAttachments() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, title: "Attach files" });
    if (!picked) return [];
    return this.attachPaths(Array.isArray(picked) ? picked : [picked]);
  }
  async attachPaths(paths: string[]) {
    const out: string[] = [];
    for (const p of paths) {
      const name = await this.invoke<string>("copy_into", { from: p, toDir: this.path(ATTACH_DIR) });
      out.push(`${ATTACH_DIR}/${name}`);
    }
    return out;
  }
  async readBytes(rel: string) {
    return fromBase64(await this.invoke<string>("read_base64", { path: this.path(rel) }));
  }
  openFile(rel: string) {
    return this.invoke<void>("open_path", { path: this.path(rel) });
  }
  async exportFile(defaultName: string, data: string | Uint8Array, filter: FileFilter) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const target = await save({ defaultPath: defaultName, filters: [filter] });
    if (!target) return null;
    if (typeof data === "string") await this.invoke("write_text", { path: target, contents: data });
    else await this.invoke("write_base64", { path: target, data: toBase64(data) });
    return target;
  }
  async importFile(filters: FileFilter[]) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const p = await open({ multiple: false, filters });
    if (typeof p !== "string") return null;
    const bytes = fromBase64(await this.invoke<string>("read_base64", { path: p }));
    const name = p.split(/[\\/]/).pop() ?? "Imported";
    return { name, text: new TextDecoder().decode(bytes), bytes };
  }
  http(url: string, method: string, headers: [string, string][], body?: string) {
    return this.invoke<HttpResult>("http_request", { url, method, headers, body: body ?? null });
  }
}

const PREFIX = "lm:file:";
const ATT_PREFIX = "lm:att:";
const DIR_PREFIX = "lm:dir:";

class BrowserStore implements Store {
  kind = "browser" as const;
  hasFolder() {
    return true;
  }
  folderLabel() {
    return "Browser storage";
  }
  async chooseFolder() {
    return true;
  }
  async list() {
    const files: MapEntry[] = [];
    const folders = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(DIR_PREFIX)) {
        const parts = k.slice(DIR_PREFIX.length).split("/");
        for (let j = 1; j <= parts.length; j++) folders.add(parts.slice(0, j).join("/"));
      }
      if (!k.startsWith(PREFIX)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k)!);
        const name = k.slice(PREFIX.length);
        files.push({ name, mtime: v.mtime });
        const parts = name.split("/");
        for (let j = 1; j < parts.length; j++) folders.add(parts.slice(0, j).join("/"));
      } catch {
        /* skip */
      }
    }
    return { files, folders: [...folders] };
  }
  async read(name: string) {
    const v = localStorage.getItem(PREFIX + name);
    if (v == null) throw new Error("Not found: " + name);
    return JSON.parse(v).text as string;
  }
  async write(name: string, text: string) {
    localStorage.setItem(PREFIX + name, JSON.stringify({ text, mtime: Date.now() }));
  }
  async rename(from: string, to: string) {
    if (localStorage.getItem(PREFIX + to) != null && from.toLowerCase() !== to.toLowerCase()) throw new Error("A map with that name exists");
    const v = localStorage.getItem(PREFIX + from);
    if (v == null) return;
    localStorage.removeItem(PREFIX + from);
    localStorage.setItem(PREFIX + to, v);
  }
  async remove(name: string) {
    localStorage.removeItem(PREFIX + name);
    localStorage.removeItem(DIR_PREFIX + name);
  }
  async makeFolder(rel: string) {
    localStorage.setItem(DIR_PREFIX + rel, "1");
  }
  pickAttachments() {
    return new Promise<string[]>((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.multiple = true;
      inp.onchange = async () => {
        const out: string[] = [];
        for (const f of Array.from(inp.files ?? [])) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          let name = f.name;
          for (let i = 2; localStorage.getItem(ATT_PREFIX + `${ATTACH_DIR}/${name}`) != null; i++) name = f.name.replace(/(\.[^.]*)?$/, ` ${i}$1`);
          try {
            localStorage.setItem(ATT_PREFIX + `${ATTACH_DIR}/${name}`, toBase64(bytes));
            out.push(`${ATTACH_DIR}/${name}`);
          } catch {
            alert("This file is too large for browser storage. The desktop app has no limit.");
          }
        }
        resolve(out);
      };
      inp.click();
    });
  }
  async attachPaths() {
    return [];
  }
  async readBytes(rel: string) {
    const v = localStorage.getItem(ATT_PREFIX + rel);
    if (v == null) throw new Error("Not found: " + rel);
    return fromBase64(v);
  }
  async openFile(rel: string) {
    const blob = new Blob([(await this.readBytes(rel)) as BlobPart], { type: mimeFor(rel) });
    window.open(URL.createObjectURL(blob), "_blank");
  }
  async exportFile(defaultName: string, data: string | Uint8Array, filter: FileFilter) {
    const blob = new Blob([data as BlobPart], { type: mimeFor("x." + filter.extensions[0]) });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return defaultName;
  }
  importFile(filters: FileFilter[]) {
    return new Promise<ImportedFile | null>((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return resolve(null);
        const bytes = new Uint8Array(await f.arrayBuffer());
        resolve({ name: f.name, text: new TextDecoder().decode(bytes), bytes });
      };
      inp.click();
    });
  }
  async http(url: string, method: string, headers: [string, string][], body?: string) {
    const r = await fetch(url, { method, headers, body });
    return { status: r.status, body: await r.text() };
  }
}

export function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const m: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    pdf: "application/pdf", md: "text/markdown", txt: "text/plain", html: "text/html", json: "application/json", opml: "text/x-opml",
  };
  return m[ext] ?? "application/octet-stream";
}

export const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name);

export function createStore(): Store {
  return isDesktop() ? new DesktopStore() : new BrowserStore();
}

/** Turn a title into a safe file name (keeps Unicode, drops path characters). */
export function fileNameFor(title: string): string {
  const base = title
    .replace(/[\n\r\t]/g, " ")
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return (base || "Untitled") + ".md";
}

/** "a/b/c.md" -> "a/b" ; "c.md" -> "" */
export const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const baseOf = (rel: string) => rel.split("/").pop()!;

/** Relative link from the map at `mapRel` to `targetRel` (both relative to the maps folder). */
export function relLink(mapRel: string, targetRel: string): string {
  const from = dirOf(mapRel).split("/").filter(Boolean);
  const to = targetRel.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

/** Resolve a link written in the map at `mapRel` back to a path relative to the maps folder. */
export function resolveLink(mapRel: string, link: string): string | null {
  if (/^[a-z]+:/i.test(link) || link.startsWith("/")) return null;
  const parts = [...dirOf(mapRel).split("/").filter(Boolean)];
  for (const seg of decodeURI(link).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg) parts.push(seg);
  }
  return parts.join("/");
}
