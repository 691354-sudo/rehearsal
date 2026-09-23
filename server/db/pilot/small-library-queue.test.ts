import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";

const now = "2026-10-01T12:00:00.000Z";
const ago = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();

describe("small Library recommendations", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); context.db.prepare("DELETE FROM items").run(); });
  afterEach(() => context.close());
  const topic = () => context.repository.library.createIsland({ language: "en", title: randomUUID() });
  const cards = (topicId: string, count: number) => Array.from({ length: count }, () =>
    context.repository.items.create({ language: "en", cue: "Пример", target: randomUUID() }, topicId));
  const listen = (cardId: string, minutesAgo: number) => context.repository.pilot.listening.complete({
    eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(), cardId,
    language: "en", completedAt: ago(minutesAgo), audioRepeatsInAppearance: 1,
  }, now);
  const enter = (cardId: string) => context.repository.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId }, now);
  const early = (cardId: string) => [120, 90, 60, 30].forEach((minute) => listen(cardId, minute));

  it.each([10, 11, 20, 50])("fills LR requests from a %i-card Library without duplicate cards", (count) => {
    const items = cards(topic().publicId, count);
    for (const limit of [10, 20, 50]) {
      const queue = context.repository.pilot.queue.listen({ limit }, now);
      expect(queue).toHaveLength(Math.min(limit, count));
      expect(new Set(queue.map((item) => item.publicId)).size).toBe(queue.length);
      expect(queue.every((item) => items.some((saved) => saved.publicId === item.publicId))).toBe(true);
    }
  });

  it.each([10, 11, 20, 50])("fills Recall requests from a %i-card ready Library", (count) => {
    cards(topic().publicId, count).forEach((item) => enter(item.publicId));
    for (const limit of [10, 20]) {
      const queue = context.repository.pilot.queue.list({ limit }, now);
      expect(queue).toHaveLength(Math.min(limit, count));
      expect(new Set(queue.map((item) => item.publicId)).size).toBe(queue.length);
    }
  });

  it("keeps the 80/20 LR mix when started cards are outside the cooldown", () => {
    const group = topic();
    cards(group.publicId, 16).forEach((item, index) => listen(item.publicId, 60 + index));
    cards(group.publicId, 10);
    const queue = context.repository.pilot.queue.listen({ limit: 20 }, now);
    expect(queue.filter((item) => item.listenCount > 0)).toHaveLength(16);
    expect(queue.filter((item) => item.listenCount === 0)).toHaveLength(4);
  });

  it("returns only unheard cards while the rest of a small Library waits for another credit", () => {
    const group = topic();
    cards(group.publicId, 8).forEach((item) => listen(item.publicId, 5));
    const unheard = cards(group.publicId, 2);
    const queue = context.repository.pilot.queue.listen({ limit: 20 }, now);
    expect(new Set(queue.map((item) => item.publicId))).toEqual(new Set(unheard.map((item) => item.publicId)));
  });

  it("fills from eligible started and unheard cards without using waiting cards", () => {
    const group = topic();
    const [started] = cards(group.publicId, 1);
    listen(started.publicId, 30);
    cards(group.publicId, 8).forEach((item) => listen(item.publicId, 29));
    cards(group.publicId, 11);
    const queue = context.repository.pilot.queue.listen({ limit: 10 }, now);
    expect(queue).toHaveLength(10);
    expect(queue[0].publicId).toBe(started.publicId);
    expect(queue.slice(1).every((item) => item.listenCount === 0)).toBe(true);
  });

  it("keeps unplayed cards eligible after a partially completed session", () => {
    cards(topic().publicId, 50);
    const first = context.repository.pilot.queue.listen({ limit: 20 }, now);
    first.forEach((item) => listen(item.publicId, 0));
    const second = context.repository.pilot.queue.listen({ limit: 20 }, now);
    expect(second.some((item) => first.some((previous) => previous.publicId === item.publicId))).toBe(false);
    second.slice(0, 4).forEach((item) => listen(item.publicId, 0));
    const larger = context.repository.pilot.queue.listen({ limit: 50 }, now);
    expect(larger).toHaveLength(26);
    expect(larger.every((item) => item.listenCount === 0)).toBe(true);
    expect(new Set(larger.map((item) => item.publicId)).size).toBe(26);
  });

  it("fills 10 Recall places when 7 cards are ready and 4 initial cards are at 4/5", () => {
    const group = topic();
    const ready = cards(group.publicId, 7);
    ready.forEach((item) => enter(item.publicId));
    cards(group.publicId, 4).forEach((item) => early(item.publicId));
    const queue = context.repository.pilot.queue.list({ limit: 10 }, now);
    expect(queue).toHaveLength(10);
    expect(new Set(queue.slice(0, 7).map((item) => item.publicId))).toEqual(new Set(ready.map((item) => item.publicId)));
    expect(queue.slice(7).every((item) => item.queueReason === "early_listen")).toBe(true);
    expect(context.repository.pilot.queue.list({ limit: 20 }, now)).toHaveLength(11);
  });

  it("fills spare Recall places only from initial 4/5 cards and leaves future FSRS unchanged", () => {
    const group = topic();
    const [arrival, future, returned, belowThreshold, disabled, tutor] = cards(group.publicId, 6);
    enter(arrival.publicId);
    const borrowed = cards(group.publicId, 4);
    borrowed.forEach((item) => early(item.publicId));
    early(disabled.publicId);
    context.db.prepare("UPDATE items SET practice_enabled=0 WHERE public_id=?").run(disabled.publicId);
    [120, 90, 60].forEach((minute) => listen(belowThreshold.publicId, minute));
    context.db.prepare("UPDATE pilot_card_progress SET stage='tutor' WHERE card_id=?").run(tutor.publicId);
    for (const item of [future, returned]) {
      context.repository.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: "", score: 1,
        verdict: "good", rating: "good", feedback: {}, reviewedAt: new Date(ago(60)) });
      context.db.prepare("UPDATE review_state SET due_at='2026-11-01T12:00:00Z' WHERE item_id=?").run(item.id);
      context.db.prepare("UPDATE pilot_card_progress SET stage=?,listen_count=4,listen_target=5,entry_pending=0 WHERE card_id=?")
        .run(item.publicId === future.publicId ? "recall" : "listen", item.publicId);
    }
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all();
    const queue = context.repository.pilot.queue.list({ limit: 20 }, now);
    expect(new Set(queue.map((item) => item.publicId))).toEqual(new Set([arrival, ...borrowed].map((item) => item.publicId)));
    expect(context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all()).toEqual(before);
  });

  it("keeps small Topic and Category queues isolated in LR and Recall", () => {
    const selected = topic(), other = topic();
    const local = cards(selected.publicId, 3), outside = cards(other.publicId, 5);
    const category = context.repository.categories.create({ language: "en", title: "Small category" });
    const extra = context.repository.categories.create({ language: "en", title: "Another category" });
    context.repository.categories.setForCard(local[0].publicId, [category.publicId, extra.publicId]);
    context.repository.categories.setForCard(outside[0].publicId, [category.publicId]);
    expect(new Set(context.repository.pilot.queue.listen({ limit: 50, topicId: selected.publicId }, now).map((item) => item.publicId)))
      .toEqual(new Set(local.map((item) => item.publicId)));
    expect(new Set(context.repository.pilot.queue.listen({ limit: 50, categoryId: category.publicId }, now).map((item) => item.publicId)))
      .toEqual(new Set([local[0].publicId, outside[0].publicId]));
    [...local, ...outside].forEach((item) => early(item.publicId));
    expect(new Set(context.repository.pilot.queue.list({ limit: 10, topicId: selected.publicId }, now).map((item) => item.publicId)))
      .toEqual(new Set(local.map((item) => item.publicId)));
    expect(new Set(context.repository.pilot.queue.list({ limit: 20, categoryId: category.publicId }, now).map((item) => item.publicId)))
      .toEqual(new Set([local[0].publicId, outside[0].publicId]));
  });
});
