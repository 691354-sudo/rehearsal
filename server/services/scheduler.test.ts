import { describe, expect, it } from "vitest";
import { cardFromStoredState, previewReview, scheduleReview } from "./scheduler.js";

const minutesBetween = (left: string, right: Date) =>
  (new Date(left).getTime() - right.getTime()) / 60_000;

describe("FSRS scheduler", () => {
  it("uses short learning steps before graduating a new card", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const card = cardFromStoredState(undefined, now);
    const preview = previewReview(card, now);

    expect(minutesBetween(preview.options.again.dueAt, now)).toBe(1);
    expect(minutesBetween(preview.options.hard.dueAt, now)).toBe(6);
    expect(minutesBetween(preview.options.good.dueAt, now)).toBe(10);
    expect(minutesBetween(preview.options.easy.dueAt, now)).toBeGreaterThanOrEqual(7 * 24 * 60);
    expect(minutesBetween(preview.options.easy.dueAt, now)).toBeLessThanOrEqual(9 * 24 * 60);
  });

  it("graduates learned cards and sends forgotten reviews through relearning", () => {
    const startedAt = new Date("2026-08-18T12:00:00.000Z");
    const first = scheduleReview(cardFromStoredState(undefined, startedAt), "good", startedAt).card;
    expect(first.state).toBe(1);

    const graduated = scheduleReview(first, "good", first.due).card;
    expect(graduated.state).toBe(2);
    expect(graduated.scheduled_days).toBe(2);

    const forgotten = scheduleReview(graduated, "again", graduated.due).card;
    expect(forgotten.state).toBe(3);
    expect(forgotten.lapses).toBe(1);
    expect(minutesBetween(forgotten.due.toISOString(), graduated.due)).toBe(1);

    const relearning = scheduleReview(forgotten, "good", forgotten.due).card;
    expect(relearning.state).toBe(3);
    expect(minutesBetween(relearning.due.toISOString(), forgotten.due)).toBe(10);
  });

  it.each([
    ["like", 60],
    ["neutral", 180],
    ["dislike", 365],
  ] as const)("enforces the %s maximum interval", (preference, maximum) => {
    let now = new Date("2026-08-18T12:00:00.000Z");
    let card = cardFromStoredState(undefined, now);
    for (let review = 0; review < 12; review += 1) {
      card = scheduleReview(card, "easy", now, preference).card;
      now = card.due;
    }
    expect(card.scheduled_days).toBeLessThanOrEqual(maximum);
  });
});
