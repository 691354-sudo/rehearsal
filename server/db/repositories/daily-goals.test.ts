import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDailyGoals, dailyGoalsSettingsSchema, type DailyGoalsSettings } from "../../../contracts/daily-goals.js";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";

const first = "2026-10-06T10:00:00.123Z";
const only = (kind: "listen" | "recall" | "tutor", target = 1): DailyGoalsSettings => Object.fromEntries(
  Object.entries(defaultDailyGoals).map(([key, value]) => [key, { ...value, enabled: key === kind, target }]),
) as DailyGoalsSettings;

describe("Daily goals and consistency", () => {
  let context: ApiTestContext;
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(first); context = createApiTestContext(); });
  afterEach(() => { context.close(); vi.useRealTimers(); });
  const goals = () => context.repository.goals;

  it("starts once, does not backfill, and defaults to the profile timezone or Riga", () => {
    goals().record("listen", "before-start", "en");
    expect(goals().snapshot()).toMatchObject({ startedAt: null, timezone: "Europe/Riga", streak: 0 });
    goals().start(); goals().start(only("recall"));
    expect(goals().snapshot().today.settings).toEqual(defaultDailyGoals);
    expect(goals().snapshot().today.counts.listen).toBe(0);
    context.reopen();
    expect(goals().snapshot().startedAt).toBe(first);
  });

  it("validates positive integers and one or more enabled goals", () => {
    for (const target of [0, -1, 1.5, NaN, Infinity, "", "10"]) {
      expect(dailyGoalsSettingsSchema.safeParse({ ...defaultDailyGoals, listen: { enabled: true, target } }).success).toBe(false);
    }
    expect(dailyGoalsSettingsSchema.safeParse({ ...only("listen"), listen: { enabled: false, target: 1 } }).success).toBe(false);
    for (const kind of ["listen", "recall", "tutor"] as const) expect(dailyGoalsSettingsSchema.safeParse(only(kind)).success).toBe(true);
    expect(() => goals().update(defaultDailyGoals)).toThrow("GOALS_NOT_STARTED");
  });

  it("uses and freezes the saved profile timezone across local midnight", () => {
    context.db.prepare("INSERT INTO app_settings(key,value) VALUES ('pilot_timezone', ?)").run(JSON.stringify("America/Los_Angeles"));
    goals().start(only("listen"), "2026-10-06T06:59:00Z");
    goals().record("listen", "before-midnight", "en", "2026-10-06T06:59:30Z");
    context.db.prepare("UPDATE app_settings SET value=? WHERE key='pilot_timezone'").run(JSON.stringify("Europe/Riga"));
    expect(goals().snapshot("2026-10-06T07:00:00Z")).toMatchObject({ timezone: "America/Los_Angeles", streak: 1,
      today: { date: "2026-10-06", counts: { listen: 0 } }, fullDays: 1 });
    expect(goals().snapshot("2026-10-06T07:00:00Z").history[0]).toMatchObject({ date: "2026-10-05", allReached: true });
  });

  it("separates progress, securing a streak, and completing all goals at exact thresholds", () => {
    goals().start();
    for (let index = 0; index < 149; index++) goals().record("listen", `listen-${index}`, "en");
    expect(goals().snapshot().today).toMatchObject({ status: "progress", anyReached: false, allReached: false });
    goals().record("listen", "listen-149", "lv");
    expect(goals().snapshot()).toMatchObject({ streak: 1, today: { status: "partial", completedGoals: 1, allReached: false } });
    for (let index = 0; index < 20; index++) goals().record("recall", `recall-${index}`, index % 2 ? "en" : "lv");
    for (let index = 0; index < 9; index++) goals().record("tutor", `tutor-${index}`, "en");
    expect(goals().snapshot().today).toMatchObject({ completedGoals: 2, allReached: false });
    goals().record("tutor", "tutor-9", "en");
    expect(goals().snapshot().today).toMatchObject({ status: "complete", anyReached: true, allReached: true });
    expect(goals().snapshot().fullDays).toBe(0);
  });

  it("counts a completed pass once irrespective of audio repeats and keeps FSRS untouched", () => {
    goals().start(only("listen", 2));
    const card = context.repository.items.list("en", 1)[0];
    const event = { eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(),
      cardId: card.publicId, language: "en" as const, completedAt: first, audioRepeatsInAppearance: 3 };
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all();
    context.repository.pilot.listening.complete(event, first);
    context.repository.pilot.listening.complete(event, first);
    expect(goals().snapshot().today.counts.listen).toBe(1);
    context.repository.pilot.listening.complete({ ...event, eventId: randomUUID(), appearanceId: randomUUID() }, first);
    expect(goals().snapshot().today.counts.listen).toBe(2);
    expect(context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all()).toEqual(before);
    context.repository.items.delete(card.publicId);
    expect(goals().snapshot().today.counts.listen).toBe(2);
  });

  it("compares only enabled goals for one, two and three goal plans", () => {
    goals().start(only("listen")); goals().record("listen", "one", "en");
    expect(goals().snapshot().today).toMatchObject({ enabledGoals: 1, anyReached: true, allReached: true });
    const two = { ...only("listen"), recall: { enabled: true, target: 1 } };
    goals().update(two);
    expect(goals().snapshot().today).toMatchObject({ enabledGoals: 2, completedGoals: 1, anyReached: true, allReached: false });
    goals().record("recall", "two", "lv");
    expect(goals().snapshot().today.allReached).toBe(true);
    goals().update({ ...two, tutor: { enabled: true, target: 1 } });
    expect(goals().snapshot().today).toMatchObject({ enabledGoals: 3, completedGoals: 2, allReached: false });
    goals().record("tutor", "three", "en");
    expect(goals().snapshot().today.allReached).toBe(true);
  });

  it("shows activity in history even when that activity's goal is disabled", () => {
    goals().start(only("recall")); goals().record("listen", "disabled-listen", "en");
    expect(goals().snapshot().today).toMatchObject({ status: "progress", anyReached: false, allReached: false });
  });

  it("recalculates today's targets and disabled goals without rewriting yesterday", () => {
    goals().start(only("listen", 2)); goals().record("listen", "a", "en");
    goals().update(only("listen", 1));
    expect(goals().snapshot()).toMatchObject({ streak: 1, today: { allReached: true } });
    goals().update(only("listen", 3));
    expect(goals().snapshot()).toMatchObject({ streak: 0, today: { allReached: false } });
    goals().update(only("listen", 1));
    vi.setSystemTime("2026-10-07T10:00:00Z");
    goals().update(only("recall", 2));
    goals().record("recall", "r1", "lv");
    expect(goals().snapshot()).toMatchObject({ streak: 1, fullDays: 1, today: { anyReached: false } });
    expect(goals().snapshot().history[0].settings).toEqual(only("listen", 1));
    context.reopen();
    expect(goals().snapshot().today.settings).toEqual(only("recall", 2));
    goals().record("recall", "r2", "en");
    expect(goals().snapshot().streak).toBe(2);
  });

  it("holds yesterday's streak during today, resets after a missed day, and retains the best", () => {
    goals().start(only("listen")); goals().record("listen", "day1", "en");
    vi.setSystemTime("2026-10-07T10:00:00Z");
    expect(goals().snapshot().streak).toBe(1);
    goals().record("listen", "day2", "en");
    vi.setSystemTime("2026-10-09T10:00:00Z");
    expect(goals().snapshot()).toMatchObject({ streak: 0, bestStreak: 2, fullDays: 2 });
    goals().record("listen", "day4", "en");
    expect(goals().snapshot()).toMatchObject({ streak: 1, bestStreak: 2 });
  });

  it("applies delayed events to their original local day and settings, including DST", () => {
    goals().start(only("listen", 2), "2026-10-24T19:00:00Z");
    goals().update(only("recall"), "2026-10-25T22:00:00Z");
    goals().record("listen", "late1", "en", "2026-10-24T21:30:00Z"); // Oct 25 in Riga
    goals().record("listen", "late2", "en", "2026-10-25T01:30:00Z"); // same day, after DST change
    goals().record("listen", "late2", "en", "2026-10-26T10:00:00Z");
    const snapshot = goals().snapshot("2026-10-26T10:00:00Z");
    expect(snapshot.history.find((day) => day.date === "2026-10-25")).toMatchObject({ counts: { listen: 2 }, allReached: true });
    expect(snapshot.today).toMatchObject({ date: "2026-10-26", settings: only("recall"), anyReached: false });
  });

  it("counts successful human exchanges across chats and languages, excludes starts and setup, and survives deletion", () => {
    goals().start(only("tutor", 2));
    const exchange = (language: "en" | "lv", automaticStart = false, mode = "openai") => {
      const clientMessageId = randomUUID();
      const user = context.repository.tutor.getOrCreateClientMessage({ language, content: "A learner response", clientMessageId, automaticStart });
      context.repository.tutor.addMessage(user.thread_id, "assistant", "A reply", { clientMessageId, mode });
      goals().recordTutor(clientMessageId);
      return user;
    };
    exchange("en", true); exchange("en", false, "setup");
    expect(goals().snapshot().today.counts.tutor).toBe(0);
    const firstMessage = exchange("en"); exchange("lv");
    expect(goals().snapshot().today.counts.tutor).toBe(2);
    context.repository.tutor.deleteThread(firstMessage.thread_public_id);
    expect(goals().snapshot().today.counts.tutor).toBe(2);
  });

  it("earns achievements only for ended full days, independently of the activity streak", () => {
    goals().start(only("listen"));
    for (let day = 6; day <= 12; day++) goals().record("listen", `day-${day}`, "en", `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);
    expect(goals().snapshot("2026-10-12T13:00:00Z").achievements[0].earned).toBe(false);
    expect(goals().snapshot("2026-10-13T13:00:00Z")).toMatchObject({ fullDays: 7, achievements: [{ days: 7, earned: true }, { days: 30, earned: false }, { days: 100, earned: false }] });
    expect(goals().snapshot("2026-12-01T13:00:00Z").history).toHaveLength(28);
  });
});
