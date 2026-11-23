// Task details (dates, duration, progress, predecessors) and scheduling.
// Dates are ISO strings (YYYY-MM-DD) in local calendar days; durations count
// both the first and the last day (Sep 20 – Sep 29 = 10 days).

import { MapNode, Plan, walk, findByAnchor } from "./model";

const DAY = 86400000;

export function parseDay(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}
export function dayStr(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}
export function addDays(s: string, n: number): string {
  return dayStr(parseDay(s) + n);
}
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Inclusive length in days. */
export function spanDays(start: string, due: string): number {
  return parseDay(due) - parseDay(start) + 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(s: string, withYear = false): string {
  const [y, m, d] = s.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? ", " + y : ""}`;
}

/** Start/due/days as far as they are known. */
export function span(p: Plan | undefined): { start?: string; due?: string; days?: number } {
  if (!p) return {};
  if (p.start && p.due) return { start: p.start, due: p.due, days: Math.max(1, spanDays(p.start, p.due)) };
  if (p.start) return { start: p.start, due: p.start, days: 1 };
  if (p.due) return { start: p.due, due: p.due, days: 1 };
  return {};
}

/** Progress 0–100: the topic's own, else the average of its sub-tasks, else from checkboxes. */
export function progressOf(n: MapNode): number | undefined {
  if (n.plan?.progress !== undefined) return n.plan.progress;
  const parts: number[] = [];
  for (const c of n.children) {
    if (c.summary) continue;
    const p = progressOf(c);
    if (p !== undefined) parts.push(p);
    else if (c.task) parts.push(c.task === "done" ? 100 : 0);
  }
  if (!parts.length) return undefined;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

/** Topics that have dates, in map order (the Gantt rows), with their depth. */
export function scheduled(root: MapNode): { node: MapNode; depth: number }[] {
  const out: { node: MapNode; depth: number }[] = [];
  const has = new Map<string, boolean>();
  const any = (n: MapNode): boolean => {
    const kids = n.children.map(any).some(Boolean); // visit every child (no short-circuit)
    const v = !!(n.plan?.start || n.plan?.due) || kids;
    has.set(n.id, v);
    return v;
  };
  any(root);
  const rec = (n: MapNode, d: number) => {
    if (!has.get(n.id)) return;
    out.push({ node: n, depth: d });
    n.children.forEach((c) => rec(c, d + 1));
  };
  rec(root, 0);
  return out;
}

/** Start/due of a topic, or of all its dated sub-topics together (a group bar). */
export function rollup(n: MapNode): { start: string; due: string } | null {
  const own = span(n.plan);
  if (own.start && own.due) return { start: own.start, due: own.due };
  let a = Infinity,
    b = -Infinity;
  walk(n, (x) => {
    const s = span(x.plan);
    if (s.start && s.due) {
      a = Math.min(a, parseDay(s.start));
      b = Math.max(b, parseDay(s.due));
    }
  });
  return a === Infinity ? null : { start: dayStr(a), due: dayStr(b) };
}

/**
 * Move successors so each one starts the day after its latest predecessor ends,
 * keeping its length. Runs until nothing changes (cycles are cut off).
 * Returns the ids of topics whose dates changed.
 */
export function reschedule(root: MapNode): Set<string> {
  const changed = new Set<string>();
  const nodes: MapNode[] = [];
  walk(root, (n) => nodes.push(n));
  for (let pass = 0; pass < nodes.length + 1; pass++) {
    let moved = false;
    for (const n of nodes) {
      const after = n.plan?.after;
      if (!after?.length) continue;
      let earliest = -Infinity;
      for (const a of after) {
        const p = findByAnchor(root, a);
        const s = p && span(p.plan);
        if (s?.due) earliest = Math.max(earliest, parseDay(s.due) + 1);
      }
      if (earliest === -Infinity) continue;
      const own = span(n.plan);
      const days = own.days ?? 1;
      const cur = own.start ? parseDay(own.start) : -Infinity;
      if (cur < earliest) {
        n.plan = { ...n.plan, start: dayStr(earliest), due: dayStr(earliest + days - 1) };
        changed.add(n.id);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return changed;
}

/** Plan with empty fields removed (undefined when nothing is left). */
export function tidyPlan(p: Plan): Plan | undefined {
  const out: Plan = {};
  if (p.progress !== undefined && !Number.isNaN(p.progress)) out.progress = Math.max(0, Math.min(100, Math.round(p.progress)));
  if (p.priority) out.priority = p.priority;
  if (p.start) out.start = p.start;
  if (p.due) out.due = p.due;
  if (p.start && p.due && parseDay(p.due) < parseDay(p.start)) out.due = p.start;
  if (p.who?.trim()) out.who = p.who.trim();
  if (p.after?.length) out.after = [...new Set(p.after)];
  return Object.keys(out).length ? out : undefined;
}

export const PRIORITY_COLORS = ["", "#e5484d", "#f76b15", "#ffb224", "#3e63dd", "#8b8d98"];
