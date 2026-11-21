// Storage backends. The desktop app (Tauri) reads and writes .md files in a
// folder you choose. In a plain browser (dev / demo) maps live in localStorage.

export interface MapEntry {
  name: string; // file name incl. ".md"
  mtime: number;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface Store {
  kind: "desktop" | "browser";
  hasFolder(): boolean;
  folderLabel(): string;
  chooseFolder(): Promise<boolean>;
  list(): Promise<MapEntry[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(name: string): Promise<void>;
  exportFile(defaultName: string, data: string | Uint8Array, filter: FileFilter): Promise<string | null>;
  importFile(filters: FileFilter[]): Promise<{ name: string; text: string } | null>;
}

export const isDesktop = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const FOLDER_KEY = "lm:folder";

function toBase64(data: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) s += String.fromCharCode(...data.subarray(i, i + chunk));
  return btoa(s);
}

class DesktopStore implements Store {
  kind = "desktop" as const;
  private folder: string | null = localStorage.getItem(FOLDER_KEY);
  private async invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }
  private path(name: string) {
    if (!this.folder) throw new Error("No folder chosen");
    const sep = this.folder.includes("\\") && !this.folder.includes("/") ? "\\" : "/";
    return this.folder.replace(/[\\/]+$/, "") + sep + name;
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
    if (!this.folder) return [];
    return this.invoke<MapEntry[]>("list_maps", { dir: this.folder });
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
    const text = await this.invoke<string>("read_text", { path: p });
    const name = p.split(/[\\/]/).pop() ?? "Imported";
    return { name, text };
  }
}

const PREFIX = "lm:file:";

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
    const out: MapEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(PREFIX)) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k)!);
        out.push({ name: k.slice(PREFIX.length), mtime: v.mtime });
      } catch {
        /* skip */
      }
    }
    return out;
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
    if (localStorage.getItem(PREFIX + to) != null) throw new Error("A map with that name exists");
    const v = localStorage.getItem(PREFIX + from);
    if (v == null) return;
    localStorage.setItem(PREFIX + to, v);
    localStorage.removeItem(PREFIX + from);
  }
  async remove(name: string) {
    localStorage.removeItem(PREFIX + name);
  }
  async exportFile(defaultName: string, data: string | Uint8Array, filter: FileFilter) {
    const type = filter.extensions[0] === "png" ? "image/png" : filter.extensions[0] === "svg" ? "image/svg+xml" : "text/plain";
    const blob = new Blob([data as BlobPart], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return defaultName;
  }
  importFile(filters: FileFilter[]) {
    return new Promise<{ name: string; text: string } | null>((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
      inp.onchange = async () => {
        const f = inp.files?.[0];
        resolve(f ? { name: f.name, text: await f.text() } : null);
      };
      inp.click();
    });
  }
}

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
