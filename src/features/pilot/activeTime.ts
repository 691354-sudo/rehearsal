export type ActiveInterval = { start: string; end: string };
type ClockState = { intervals: ActiveInterval[]; measurementLost: boolean; open: boolean };

export class ActiveTime {
  private startAt: number | null = null;
  private lastInteraction = 0;
  private intervals: ActiveInterval[] = [];
  private lost = false;
  constructor(private readonly idleMs: number, private readonly save: (state: ClockState) => void, restored?: ClockState) {
    if (restored) { this.intervals = restored.intervals; this.lost = restored.measurementLost || restored.open; }
  }
  resume(now: number) { this.lastInteraction = now; this.startAt = now; this.persist(); }
  activity(now: number) {
    this.closeSegment(now);
    this.lastInteraction = now; this.startAt = now; this.persist();
  }
  pause(now: number) { this.closeSegment(now); this.startAt = null; this.persist(); }
  snapshot(now: number) {
    if (this.startAt !== null) { this.closeSegment(now); this.startAt = now; }
    this.persist();
    return { intervals: [...this.intervals], measurementLost: this.lost };
  }
  seconds(now: number): number | null {
    const state = this.snapshot(now);
    return state.measurementLost ? null : state.intervals.reduce((sum, interval) => sum
      + (Date.parse(interval.end) - Date.parse(interval.start)) / 1000, 0);
  }
  acknowledge(intervals: ActiveInterval[]) {
    const accepted = new Set(intervals.map((interval) => `${interval.start}/${interval.end}`));
    this.intervals = this.intervals.filter((interval) => !accepted.has(`${interval.start}/${interval.end}`));
    this.persist();
  }
  private closeSegment(now: number) {
    if (this.startAt === null) return;
    const end = Math.min(now, this.lastInteraction + this.idleMs);
    if (end > this.startAt) this.intervals.push({ start: new Date(this.startAt).toISOString(), end: new Date(end).toISOString() });
  }
  private persist() {
    try { this.save({ intervals: this.intervals, measurementLost: this.lost, open: this.startAt !== null }); }
    catch { this.lost = true; }
  }
}
export type { ClockState };
