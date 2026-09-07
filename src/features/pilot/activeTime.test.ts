import { describe, expect, it } from "vitest";
import { ActiveTime, type ClockState } from "./activeTime";

describe("active study clock", () => {
  it("excludes hidden and idle time, resumes after interaction, and acknowledges only persisted intervals", () => {
    const clock = new ActiveTime(120000, () => undefined);
    clock.resume(1000); clock.activity(6000); clock.pause(11000);
    expect(clock.seconds(90000)).toBe(10);
    clock.resume(100000); clock.activity(250000);
    expect(clock.seconds(251000)).toBe(131);
    const saved = clock.snapshot(251000); clock.activity(253000);
    clock.acknowledge(saved.intervals);
    expect(clock.seconds(253000)).toBe(2);
  });
  it("preserves an orderly reload but reports an interrupted or failed measurement as null", () => {
    let state: ClockState | undefined;
    const clock = new ActiveTime(120000, (next) => { state = structuredClone(next); });
    clock.resume(1000); clock.pause(2000);
    expect(new ActiveTime(120000, () => undefined, state).seconds(3000)).toBe(1);
    clock.resume(3000);
    expect(new ActiveTime(120000, () => undefined, state).seconds(4000)).toBeNull();
    expect(new ActiveTime(120000, () => { throw new Error("Storage full"); }).seconds(4000)).toBeNull();
  });
});
