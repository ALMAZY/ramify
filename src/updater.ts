// In-app updates. The desktop app asks GitHub for latest.json (written by the
// release workflow), and if there is a newer signed version it shows a banner:
// what's new, then one click to download, install and restart.

import type { App } from "./app";
import { isDesktop } from "./storage";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { openExternal } from "./notes";

const AUTO_KEY = "lm:update-auto";
const SKIP_KEY = "lm:update-skip";
const CHECK_EVERY = 6 * 60 * 60 * 1000; // 6 hours

export const RELEASES_URL = "https://github.com/ALMAZY/ramify/releases";

export function autoCheckEnabled(): boolean {
  return localStorage.getItem(AUTO_KEY) !== "off";
}
export function setAutoCheck(on: boolean) {
  localStorage.setItem(AUTO_KEY, on ? "on" : "off");
}

/** Version baked in at build time from package.json (no IPC, never fails). */
export async function appVersion(): Promise<string> {
  return import.meta.env.VITE_APP_VERSION ?? "dev";
}

export class Updater {
  private banner: HTMLElement | null = null;
  private busy = false;

  constructor(private app: App) {}

  /** Check soon after start, then every few hours (if the user has not turned it off). */
  startAutoCheck() {
    if (!isDesktop()) return;
    setTimeout(() => autoCheckEnabled() && void this.check(true), 8000);
    setInterval(() => autoCheckEnabled() && void this.check(true), CHECK_EVERY);
  }

  /** `silent`: say nothing when there is no update or the check fails (automatic checks). */
  async check(silent = false) {
    if (this.busy) return;
    if (!isDesktop()) {
      if (!silent) this.app.toast("Updates are for the desktop app. See " + RELEASES_URL);
      return;
    }
    this.busy = true;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check({ timeout: 20000 });
      if (!update) {
        if (!silent) this.app.toast(`Ramify ${await appVersion()} is the latest version`);
        return;
      }
      if (silent && localStorage.getItem(SKIP_KEY) === update.version) return;
      this.show(update);
    } catch (err) {
      if (!silent) this.app.toast("Could not check for updates: " + String((err as Error).message ?? err));
    } finally {
      this.busy = false;
    }
  }

  private show(update: any) {
    this.banner?.remove();
    const el = document.createElement("div");
    el.className = "update-banner";
    const notes = update.body ? DOMPurify.sanitize(new Marked({ gfm: true }).parse(update.body, { async: false }) as string) : "";
    el.innerHTML = `
      <div class="ub-head">
        <strong>Ramify ${escape(update.version)} is available</strong>
        <span class="ub-cur">You have ${escape(update.currentVersion)}</span>
      </div>
      ${notes ? `<details class="ub-notes"><summary>What's new</summary><div class="md">${notes}</div></details>` : ""}
      <div class="ub-progress" hidden><div class="ub-bar"><i></i></div><span class="ub-status">Starting…</span></div>
      <div class="ub-actions">
        <button class="ub-skip link-btn">Skip this version</button>
        <span class="spacer"></span>
        <button class="ub-later">Later</button>
        <button class="ub-go primary">Update and restart</button>
      </div>`;
    document.body.append(el);
    this.banner = el;
    el.querySelectorAll<HTMLAnchorElement>(".md a[href]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        void openExternal(a.href);
      }),
    );
    const close = () => {
      el.remove();
      this.banner = null;
      this.app.focusSink();
    };
    el.querySelector<HTMLButtonElement>(".ub-later")!.onclick = close;
    el.querySelector<HTMLButtonElement>(".ub-skip")!.onclick = () => {
      localStorage.setItem(SKIP_KEY, update.version);
      close();
    };
    el.querySelector<HTMLButtonElement>(".ub-go")!.onclick = () => void this.install(update, el);
  }

  private async install(update: any, el: HTMLElement) {
    el.querySelector<HTMLElement>(".ub-actions")!.hidden = true;
    const prog = el.querySelector<HTMLElement>(".ub-progress")!;
    prog.hidden = false;
    const bar = el.querySelector<HTMLElement>(".ub-bar i")!;
    const status = el.querySelector<HTMLElement>(".ub-status")!;
    // Save first: on Windows the installer closes the app.
    await this.app.flush();
    let total = 0,
      got = 0;
    try {
      await update.downloadAndInstall((ev: any) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
          status.textContent = "Downloading…";
        } else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          const pct = total ? Math.min(100, Math.round((got / total) * 100)) : 0;
          bar.style.width = pct + "%";
          status.textContent = total ? `Downloading… ${pct}%` : `Downloading… ${(got / 1e6).toFixed(1)} MB`;
        } else if (ev.event === "Finished") {
          bar.style.width = "100%";
          status.textContent = "Installing…";
        }
      });
      status.textContent = "Restarting…";
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (err) {
      status.textContent = "Update failed: " + String((err as Error).message ?? err);
      el.querySelector<HTMLElement>(".ub-actions")!.hidden = false;
    }
  }
}

function escape(s: string) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
