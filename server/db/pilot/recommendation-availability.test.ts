import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";

const now = "2026-10-01T12:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(now) + minutes * 60_000).toISOString();
describe("adaptive recommendation availability", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); context.db.prepare("DELETE FROM items").run(); });
  afterEach(() => context.close());
  const cards = (count: number) => {
    const topic = context.repository.library.createIsland({ language: "en", title: randomUUID() });
    return context.db.transaction(() => Array.from({ length: count }, () =>
      context.repository.items.create({ language: "en", cue: "Пример", target: randomUUID() }, topic.publicId)))();
  };
  const play = (cardId: string, minute: number) => context.repository.pilot.listening.complete({
    eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(), cardId,
    language: "en", completedAt: at(minute), audioRepeatsInAppearance: 1,
  }, at(minute));

  it("selects every eligible card for All, scopes the count, and freezes the Recall session", () => {
    const items = cards(65), topicId = items[0].topicId!;
    cards(3);
    play(items[0].publicId, -5);
    const listen = context.repository.pilot.queue.listenRecommendations({ limit: "all", topicId }, now);
    expect(listen.items).toHaveLength(64);
    expect(listen.recommendation).toMatchObject({ availableCount: 64, waitingCount: 1 });
    items.forEach((item) => context.repository.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId: item.publicId }, now));
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all();
    const input = { limit: "all" as const, topicId, language: "en" as const }, sessionId = randomUUID();
    expect(context.repository.pilot.queue.recallRecommendations(input, now).recommendation.availableCount).toBe(65);
    expect(context.repository.pilot.queue.start(sessionId, input, now)).toHaveLength(65);
    const extra = context.repository.items.create({ language: "en", cue: "Позже", target: "Added later" }, topicId);
    context.repository.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId: extra.publicId }, at(1));
    expect(context.repository.pilot.queue.list({ ...input, sessionId }, at(2))).toHaveLength(65);
    expect(context.repository.pilot.queue.list({ ...input, limit: 10, sessionId }, at(2))).toHaveLength(65);
    expect(context.repository.pilot.queue.start(sessionId, input, at(2))).toHaveLength(65);
    expect(context.db.prepare("SELECT * FROM review_state WHERE item_id<>? ORDER BY item_id").all(extra.id)).toEqual(before);
  });

  it.each([0, 1, 2, 5, 9, 10, 11, 20, 30, 40, 50, 60, 100, 500, 1000])("adapts all limits to %i new cards without mutating progress", (count) => {
    cards(count);
    const before = context.db.prepare("SELECT * FROM pilot_card_progress ORDER BY card_id").all();
    for (const limit of [10, 20, 50]) {
      const result = context.repository.pilot.queue.listenRecommendations({ limit }, now);
      expect(result.items).toHaveLength(Math.min(limit, count));
      expect(new Set(result.items.map((item) => item.publicId)).size).toBe(result.items.length);
      expect(result.recommendation).toEqual({ availableCount: count, waitingCount: 0, nextAvailableAt: null, serverTime: now });
    }
    expect(context.db.prepare("SELECT * FROM pilot_card_progress ORDER BY card_id").all()).toEqual(before);
  });

  it.each([
    [10, [10, 0, 0]], [20, [20, 0, 0]], [30, [20, 10, 0]],
    [50, [20, 20, 10]], [60, [20, 20, 20]], [1000, [20, 20, 20]],
  ] as const)("does not pad successive sessions in a %i-card Library", (count, expected) => {
    cards(count);
    const lengths = [0, 5, 10].map((minute) => {
      const result = context.repository.pilot.queue.listenRecommendations({ limit: 20 }, at(minute));
      result.items.forEach((item) => play(item.publicId, minute));
      return result.items.length;
    });
    expect(lengths).toEqual(expected);
    expect(context.repository.pilot.queue.listenRecommendations({ limit: 20 }, at(30)).items).toHaveLength(Math.min(count, 20));
  });

  it("redistributes 80/20 shortages across 120 mixtures without borrowing waiting cards", () => {
    const items = cards(180);
    const update = context.db.prepare("UPDATE pilot_card_progress SET stage=?,listen_count=?,last_listen_at=?,last_credited_at=? WHERE card_id=?");
    for (const started of [0, 1, 8, 16, 40]) for (const fresh of [0, 1, 2, 4, 20, 100]) for (const waiting of [0, 1, 9, 40]) {
      context.db.transaction(() => {
        items.forEach((item, index) => {
          const isStarted = index < started, isNew = !isStarted && index < started + fresh;
          const stamp = isStarted ? at(-60) : isNew ? null : at(-5);
          update.run(index < started + fresh + waiting ? "listen" : "tutor", isNew ? 0 : 1, stamp, stamp, item.publicId);
        });
      })();
      for (const limit of [10, 20, 50]) {
        const result = context.repository.pilot.queue.listenRecommendations({ limit }, now);
        const size = Math.min(limit, started + fresh);
        expect(result.items).toHaveLength(size);
        expect(result.items.filter((item) => item.listenCount > 0)).toHaveLength(Math.min(started, Math.max(Math.ceil(size * .8), size - fresh)));
        expect(result.recommendation).toEqual({ availableCount: started + fresh, waitingCount: waiting,
          nextAvailableAt: waiting ? at(25) : null, serverTime: now });
      }
    }
  });

  it("uses independent credit clocks, including the exact boundary and noncredited manual repeats", () => {
    const items = cards(10);
    items.forEach((item, index) => play(item.publicId, index));
    expect(play(items[0].publicId, 29).listenCount).toBe(1);
    const result = context.repository.pilot.queue.listenRecommendations({}, at(29));
    expect(result.items).toEqual([]);
    expect(result.recommendation).toEqual({ availableCount: 0, waitingCount: 10, nextAvailableAt: at(30), serverTime: at(29) });
    for (const [minute, count] of [[29.999, 0], [30, 1], [31, 2], [35, 6], [39, 10]]) {
      expect(context.repository.pilot.queue.listenRecommendations({}, at(minute)).items).toHaveLength(count);
    }
    expect(play(items[0].publicId, 30).listenCount).toBe(2);
  });

  it("scopes availability to the selected category, excluding disabled and non-LR cards", () => {
    const [ready, waiting, outside, disabled, tutor] = cards(5);
    const category = context.repository.categories.create({ language: "en", title: "Selected" });
    [ready, waiting, disabled, tutor].forEach((item) => context.repository.categories.setForCard(item.publicId, [category.publicId]));
    play(waiting.publicId, -5); play(outside.publicId, -10);
    context.db.prepare("UPDATE items SET practice_enabled=0 WHERE public_id=?").run(disabled.publicId);
    context.db.prepare("UPDATE pilot_card_progress SET stage='tutor' WHERE card_id=?").run(tutor.publicId);
    const result = context.repository.pilot.queue.listenRecommendations({ limit: 50, categoryId: category.publicId }, now);
    expect(result.items.map((item) => item.publicId)).toEqual([ready.publicId]);
    expect(result.recommendation).toEqual({ availableCount: 1, waitingCount: 1, nextAvailableAt: at(25), serverTime: now });
  });

  it("keeps returned cards on their credit clock and removes them from LR after two extra credits", () => {
    const [item] = cards(1);
    play(item.publicId, -60);
    context.repository.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: "", score: 0,
      verdict: "again", rating: "again", feedback: {}, reviewedAt: new Date(at(-1)) });
    context.db.prepare("UPDATE pilot_card_progress SET stage='listen',listen_target=listen_count+2,entered_at=? WHERE card_id=?").run(at(-1), item.publicId);
    expect(context.repository.pilot.queue.listen({}, now)).toHaveLength(1);
    play(item.publicId, 0);
    expect(context.repository.pilot.queue.listen({}, at(5))).toHaveLength(0);
    expect(context.repository.pilot.queue.list({}, at(5))).toHaveLength(0);
    play(item.publicId, 30);
    expect(context.repository.pilot.queue.listenRecommendations({}, at(31)).recommendation).toMatchObject({ availableCount: 0, waitingCount: 0, nextAvailableAt: null });
    expect(context.repository.pilot.queue.list({}, at(31))).toHaveLength(1);
  });

  it("explains nine due cards out of eleven without changing future FSRS dates", () => {
    const items = cards(11);
    items.forEach((item, index) => {
      context.repository.practice.recordAttempt({ itemPublicId: item.publicId, mode: "recall", answer: "", score: 1,
        verdict: "good", rating: "good", feedback: {}, reviewedAt: new Date(at(-60)) });
      context.db.prepare("UPDATE pilot_card_progress SET stage='recall',entry_pending=0 WHERE card_id=?").run(item.publicId);
      context.db.prepare("UPDATE review_state SET due_at=? WHERE item_id=?").run(at(index < 9 ? -1 : 60), item.id);
    });
    const before = context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all();
    const result = context.repository.pilot.queue.recallRecommendations({ limit: 10 }, now);
    expect(result.items).toHaveLength(9);
    expect(result.recommendation).toEqual({ availableCount: 9, waitingCount: 2, nextAvailableAt: at(60), serverTime: now });
    expect(context.repository.pilot.queue.recallRecommendations({ limit: 20 }, at(60)).items).toHaveLength(11);
    expect(context.db.prepare("SELECT * FROM review_state ORDER BY item_id").all()).toEqual(before);
  });

  it("never expands a frozen Recall session when another card becomes available", () => {
    cards(11).forEach((item) => context.repository.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId: item.publicId }, now));
    const sessionId = randomUUID(), input = { language: "en" as const, limit: 10 };
    const selected = context.repository.pilot.queue.start(sessionId, input, now);
    context.db.prepare("UPDATE pilot_card_progress SET stage='tutor' WHERE card_id=?").run(selected[0].publicId);
    const resumed = context.repository.pilot.queue.start(sessionId, input, at(5));
    expect(resumed).toHaveLength(9);
    expect(resumed.every((item) => selected.some((previous) => previous.publicId === item.publicId))).toBe(true);
  });
});
