import { useEffect, useMemo, useRef } from "react";
import { ActiveTime, type ClockState } from "./activeTime";
import type { Homework, HomeworkTime } from "../../../contracts/learning-pilot";
import { pilotRequest } from "./pilotApi";
import { usePilot } from "./PilotProvider";

export function useActiveTime(key: string, enabled: boolean, idleSeconds: number) {
  const clock = useMemo(() => {
    let state: ClockState | undefined;
    try { const saved = localStorage.getItem(key); if (saved) state = JSON.parse(saved); } catch { state = { intervals: [], measurementLost: true, open: false }; }
    return new ActiveTime(idleSeconds * 1000, (next) => localStorage.setItem(key, JSON.stringify(next)), state);
  }, [key, idleSeconds]);
  useEffect(() => {
    if (!enabled) return;
    const activity = () => { if (document.visibilityState === "visible") clock.activity(Date.now()); };
    const visibility = () => document.visibilityState === "hidden" ? clock.pause(Date.now()) : clock.resume(Date.now());
    const hide = () => clock.pause(Date.now());
    visibility();
    window.addEventListener("pointerdown", activity); window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", hide);
    return () => {
      clock.pause(Date.now()); window.removeEventListener("pointerdown", activity); window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", hide);
    };
  }, [clock, enabled]);
  return clock;
}

export function useHomeworkTime(homework: Homework | null, stage: "recall" | "tutor", enabled: boolean) {
  const { profileId, settings } = usePilot();
  const key = `rehearsal:${profileId}:en:homework-time:${homework?.homeworkId ?? "none"}:${stage}`;
  const clock = useActiveTime(key, enabled && Boolean(homework), homework?.settingsSnapshot.idleTimeoutSeconds ?? settings?.idleTimeoutSeconds ?? 120);
  const saving = useRef<Promise<Homework | null> | null>(null);
  const flush = () => {
    if (!homework) return Promise.resolve(null);
    if (saving.current) return saving.current;
    const run = async () => {
      const pendingKey = `${key}:pending`;
      const stored = localStorage.getItem(pendingKey);
      const send = async (body: HomeworkTime) => {
        localStorage.setItem(pendingKey, JSON.stringify(body));
        const response = await pilotRequest<{ homework: Homework }>(profileId, `/homework/${homework.homeworkId}/time`, body);
        clock.acknowledge(body.intervals); localStorage.removeItem(pendingKey);
        return response.homework;
      };
      if (stored) await send(JSON.parse(stored));
      const snapshot = clock.snapshot(Date.now());
      let updated = homework;
      // Bound each write while retaining every accumulated interval.
      do {
        const intervals = snapshot.intervals.splice(0, 1000);
        updated = await send({ eventId: crypto.randomUUID(), stage, intervals, measurementLost: snapshot.measurementLost });
      } while (snapshot.intervals.length);
      return updated;
    };
    saving.current = run().finally(() => { saving.current = null; });
    return saving.current;
  };
  return { flush, clock };
}
