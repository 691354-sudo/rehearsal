import type { HomeworkTime } from "../../../contracts/learning-pilot.js";
import { PilotError, PilotStore } from "./store.js";

export const intervalSeconds = (intervals: Array<{ start: string; end: string }>) => {
  const sorted = intervals.map((interval) => [Date.parse(interval.start), Date.parse(interval.end)])
    .sort((a, b) => a[0] - b[0]);
  let end = 0;
  let total = 0;
  for (const [start, finish] of sorted) {
    total += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  return total / 1000;
};

export class PilotTiming {
  constructor(private readonly store: PilotStore) {}

  record(homeworkId: string, input: HomeworkTime, now = new Date().toISOString()) {
    const { db } = this.store;
    return db.transaction(() => {
      const homework = this.store.homework(homeworkId);
      const previous = this.store.event(input.eventId);
      const payload = { homeworkId, ...input };
      if (previous) {
        if (previous.data !== JSON.stringify(payload) || previous.kind !== "homework_active_time") {
          throw new PilotError("PILOT_EVENT_ID_CONFLICT");
        }
        return homework;
      }
      if (homework.status !== `${input.stage}_in_progress`) throw new PilotError("HOMEWORK_STAGE_FINISHED");
      const stageStart = input.stage === "recall" ? homework.startedAt : homework.returnedToTutorAt ?? homework.startedAt;
      for (const interval of input.intervals) {
        const start = Date.parse(interval.start);
        const end = Date.parse(interval.end);
        if (start < Date.parse(stageStart) - 1000 || end < start || end > Date.parse(now) + 1000
          || end - start > homework.settingsSnapshot.idleTimeoutSeconds * 1000 + 1000) {
          throw new PilotError("INVALID_ACTIVE_INTERVAL", 400);
        }
      }
      // Store the payload only once; the event row supplies identity/version/time.
      this.store.addEvent(input.eventId, "homework_active_time", null, now, payload, now,
        homework.settingsSnapshot.experimentVersion);
      db.prepare(`INSERT INTO pilot_time_intervals(event_id, homework_id, stage, measurement_lost)
        VALUES (?, ?, ?, ?)`)
        .run(input.eventId, homeworkId, input.stage, Number(input.measurementLost));
      const rows = db.prepare(`SELECT t.measurement_lost, e.data FROM pilot_time_intervals t
        JOIN pilot_events e ON e.event_id = t.event_id
        WHERE t.homework_id = ? AND t.stage = ?`).all(homeworkId, input.stage) as Array<{
          measurement_lost: number; data: string;
        }>;
      const seconds = rows.some((row) => row.measurement_lost) ? null
        : intervalSeconds(rows.flatMap((row) => JSON.parse(row.data).intervals));
      return this.store.updateHomework(homeworkId,
        input.stage === "recall" ? { actualRecallSeconds: seconds } : { actualTutorSeconds: seconds });
    }).immediate();
  }
}
