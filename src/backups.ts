// Automatic backups. Before a map is saved, the version on disk is copied to
// .ramify/history/<map>/<time>.md (a hidden folder in the maps folder):
//  - at most one copy every 5 minutes while you work,
//  - always right away when a save would remove a lot of topics,
// and old copies are thinned out: everything from the last hour, one per hour
// for a day, one per day for 30 days, and never fewer than the 10 newest.

import type { Store } from "./storage";

const EVERY = 5 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Topics in a map file: the heading plus every list item. */
export function topicCount(md: string): number {
  return (md.match(/^\s*(?:[-*+]|\d+[.)])\s+/gm)?.length ?? 0) + 1;
}

/** A save that removes at least 3 topics and more than a quarter of them. */
export function bigLoss(before: string, after: string): boolean {
  const a = topicCount(before),
    b = topicCount(after);
  return a - b >= 3 && b < a * 0.75;
}

/** Which backup times (ms) to keep. */
export function keep(times: number[], now: number): Set<number> {
  const sorted = [...times].sort((a, b) => b - a);
  const out = new Set<number>(sorted.slice(0, 10));
  const seen = new Set<string>();
  for (const t of sorted) {
    const age = now - t;
    if (age < HOUR) out.add(t);
    else if (age < DAY) {
      const k = "h" + Math.floor(t / HOUR);
      if (!seen.has(k)) (seen.add(k), out.add(t));
    } else if (age < 30 * DAY) {
      const k = "d" + Math.floor(t / DAY);
      if (!seen.has(k)) (seen.add(k), out.add(t));
    }
  }
  return out;
}

export class Backups {
  private last = new Map<string, number>();

  constructor(private store: Store) {}

  /** Call before writing `next` over `prev` (the text that is on disk now). */
  async beforeSave(name: string, prev: string, next: string) {
    if (!prev.trim() || prev === next) return;
    const now = Date.now();
    const loss = bigLoss(prev, next);
    if (!loss && now - (this.last.get(name) ?? 0) < EVERY) return;
    await this.snapshot(name, prev, now);
  }

  /** Copy a version now (before a restore, a reload from disk, a delete…). */
  async snapshot(name: string, text: string, now = Date.now()) {
    if (!text.trim()) return;
    try {
      await this.store.saveBackup(name, String(now), text);
      this.last.set(name, now);
      await this.prune(name, now);
    } catch {
      /* a backup must never stop a save */
    }
  }

  async list(name: string): Promise<number[]> {
    try {
      return (await this.store.listBackups(name)).map(Number).filter((n) => n > 0).sort((a, b) => b - a);
    } catch {
      return [];
    }
  }

  read(name: string, time: number) {
    return this.store.readBackup(name, String(time));
  }

  private async prune(name: string, now: number) {
    const all = await this.list(name);
    const k = keep(all, now);
    for (const t of all) if (!k.has(t)) await this.store.deleteBackup(name, String(t)).catch(() => undefined);
  }
}
