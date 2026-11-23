import { describe, it, expect } from "vitest";
import { keep, bigLoss, topicCount } from "../src/backups";

const H = 3_600_000;
describe("backups", () => {
  it("counts topics", () => expect(topicCount("# A\n- b\n  - c\n> note\n- [ ] d\n")).toBe(4));
  it("sees a big loss", () => {
    const before = "# A\n" + Array.from({ length: 20 }, (_, i) => `- t${i}`).join("\n");
    expect(bigLoss(before, "# A\n- t0\n")).toBe(true);
    expect(bigLoss(before, before + "\n- more")).toBe(false);
    expect(bigLoss("# A\n- a\n- b", "# A\n- a")).toBe(false); // small edits are not a loss
  });
  it("thins out old copies", () => {
    const now = 1000 * H;
    const times: number[] = [];
    for (let m = 0; m < 60 * 24 * 40; m += 5) times.push(now - m * 60_000); // every 5 min for 40 days
    const k = keep(times, now);
    const inHour = times.filter((t) => now - t < H).length;
    expect([...k].filter((t) => now - t < H).length).toBe(inHour);
    expect([...k].filter((t) => now - t >= H && now - t < 24 * H).length).toBeLessThanOrEqual(24);
    expect([...k].filter((t) => now - t >= 30 * 24 * H).length).toBe(0);
    expect(k.size).toBeLessThan(90);
  });
  it("always keeps the 10 newest", () => {
    const now = 1000 * H;
    const old = Array.from({ length: 15 }, (_, i) => now - (40 + i) * 24 * H);
    expect(keep(old, now).size).toBe(10);
  });
});
