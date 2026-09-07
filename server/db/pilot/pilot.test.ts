import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";
import type { ListenAppearance, PilotAttemptGrade } from "../../../contracts/learning-pilot.js";
import type { ReviewRating } from "../../../contracts/api.js";
import { RehearsalRepository } from "../repository.js";
import { openDatabase } from "../database.js";

const now = "2026-09-07T10:00:00.000Z";
const later = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
describe("English learning pilot", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());
  const pilot = () => context.repository.pilot;
  const card = (name = randomUUID(), language: "en" | "lv" = "en") => {
    const topic = context.repository.library.createIsland({ language, title: `Pilot ${name}` });
    return context.repository.items.create({ language, publicId: name, cue: `Фраза ${name}`, target: `Phrase ${name}.` }, topic.publicId);
  };
  const appearance = (cardId: string, n = 0): ListenAppearance => ({ eventId: randomUUID(), language: "en",
    cardId, listenSessionId: randomUUID(), appearanceId: randomUUID(), completedAt: later(-60 + n), audioRepeatsInAppearance: 3 });
  const listen = (cardId: string, count = 5) => {
    for (let n = 0; n < count; n++) pilot().listening.complete(appearance(cardId, n), later(-60 + n));
  };
  const due = (cardId: string) => context.repository.practice.recordAttempt({ itemPublicId: cardId,
    mode: "recall", answer: "", score: 1, verdict: "easy", rating: "easy", feedback: {}, reviewedAt: new Date("2020-01-01T00:00:00.000Z") });
  const start = (cardId: string, seconds = 0, homeworkId?: string) => {
    const attemptId = randomUUID();
    pilot().recall.begin({ attemptId, cardId, homeworkId, shownAt: later(seconds), timezone: "Europe/Riga" }, later(seconds));
    return attemptId;
  };
  const grade = (attemptId: string, rating: ReviewRating = "good", seconds = 20): PilotAttemptGrade => ({
    attemptId, rating, revealedAt: later(seconds - 5), ratedAt: later(seconds), responseTimeMs: 10_000,
    inputMode: "oral_self_check", answer: "",
  });
  const like = (cardId: string, liked = true, seconds = 0) => pilot().listening.like({
    eventId: randomUUID(), language: "en", cardId, liked, occurredAt: later(seconds),
  }, later(seconds));
  const homework = (requestedMinutes = 20) => pilot().homework.create({
    homeworkId: randomUUID(), requestedMinutes, timezone: "Europe/Riga",
  }, now);

  it("counts only 17 finished appearances from 50 cards, once per appearance, without FSRS", () => {
    const cards = Array.from({ length: 50 }, () => card());
    const events = cards.slice(0, 17).map((item) => appearance(item.publicId));
    events.forEach((event) => pilot().listening.complete(event, now));
    context.reopen();
    events.forEach((event) => {
      pilot().listening.complete(event, now);
      pilot().listening.complete({ ...event, eventId: randomUUID() }, now);
    });
    expect(cards.map((item) => pilot().store.progress(item.publicId).listenCount))
      .toEqual([...Array(17).fill(1), ...Array(33).fill(0)]);
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM pilot_listens").get()).toEqual({ n: 17 });
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM review_state").get()).toEqual({ n: 0 });
  });

  it("requires five measured listens for a new card, but preserves old Recall history", () => {
    const fresh = card(); const old = card();
    listen(fresh.publicId, 4); due(old.publicId);
    expect(pilot().queue.list({}, now).map((item) => item.publicId)).toEqual([old.publicId]);
    listen(fresh.publicId, 1);
    expect(pilot().queue.list({}, now).map((item) => item.publicId)).toEqual([old.publicId, fresh.publicId]);
    expect(pilot().store.progress(old.publicId)).toMatchObject({ listenCount: 0, recallEligibleAt: null, successfulRecallCount: 1 });
  });

  it("supports oral manual grading, counts Hard cumulatively, and persists exactly once across reload", () => {
    const item = card(); listen(item.publicId);
    const attempt = start(item.publicId);
    const body = grade(attempt, "hard");
    const accepted = pilot().recall.grade(body, later(20));
    expect(accepted.successfulRecallCount).toBe(1);
    expect(accepted.fsrsStateBefore).toBeNull();
    expect(pilot().queue.list({}, later(21))).toHaveLength(0);
    context.reopen();
    expect(pilot().recall.grade(body, later(30))).toEqual(accepted);
    expect(() => pilot().recall.grade({ ...body, rating: "easy" }, later(30))).toThrow("ATTEMPT_ID_CONFLICT");
    const nextDue = accepted.fsrsStateAfter!.dueAt;
    const secondId = randomUUID();
    pilot().recall.begin({ attemptId: secondId, cardId: item.publicId, shownAt: nextDue, timezone: "Europe/Riga" }, nextDue);
    pilot().recall.grade({ ...grade(secondId, "good"), revealedAt: nextDue, ratedAt: nextDue, responseTimeMs: 0 }, nextDue);
    expect(pilot().store.progress(item.publicId).successfulRecallCount).toBe(2);
  });

  it("Again changes FSRS without adding a success", () => {
    const item = card(); listen(item.publicId);
    const result = pilot().recall.grade(grade(start(item.publicId), "again"), later(20));
    expect(result.successfulRecallCount).toBe(0);
    expect(result.fsrsStateAfter?.repetitions).toBe(1);
  });

  it("applies overlapping in-flight reviews to current state across database connections", () => {
    const item = card(); listen(item.publicId);
    const one = start(item.publicId); const two = start(item.publicId);
    const secondDb = openDatabase(context.databasePath);
    try {
      const other = new RehearsalRepository(secondDb);
      const first = pilot().recall.grade(grade(one, "hard"), later(20));
      const second = other.pilot.recall.grade(grade(two, "good", 21), later(21));
      expect(second.fsrsStateBefore).toEqual(first.fsrsStateAfter);
      expect(second.fsrsStateAfter?.repetitions).toBe(2);
    } finally { secondDb.close(); }
  });

  it("Like and preference do not change uniform scheduling, counts, or admission", () => {
    const item = card(); listen(item.publicId, 1);
    like(item.publicId);
    expect(pilot().store.progress(item.publicId)).toMatchObject({ listenCount: 1, successfulRecallCount: 0 });
    expect(pilot().store.review(item.publicId)).toBeNull();
    expect(pilot().queue.list({}, now)).toHaveLength(0);
    const presets = pilot().store.settings().scheduler.presets;
    expect(presets.like).toEqual(presets.neutral);
    expect(presets.dislike).toEqual(presets.neutral);
    expect(presets.neutral.requestRetention).toBe(.90);
  });

  it("does not bulk-queue old likes; dedupes new likes, cancels unstarted ones, and retains history", () => {
    const old = card(); const item = card();
    context.repository.items.updatePreference(old.publicId, "like");
    expect(pilot().listening.pending()).toHaveLength(0);
    const event = { eventId: randomUUID(), language: "en" as const, cardId: item.publicId, liked: true, occurredAt: now };
    pilot().listening.like(event, now); pilot().listening.like(event, now);
    expect(pilot().listening.pending()).toHaveLength(1);
    context.reopen(); like(item.publicId, false, 10);
    expect(pilot().listening.pending()).toHaveLength(0);
    like(item.publicId, true, 20);
    expect(pilot().listening.pending()).toHaveLength(1);
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM pilot_priority_requests").get()).toEqual({ n: 2 });
  });

  it("plans 20 and 100 minutes from all due cards and freezes settings", () => {
    for (let n = 0; n < 100; n++) due(card().publicId);
    const twenty = homework(); const hundred = homework(100);
    expect(twenty).toMatchObject({ plannedRecallCards: 15, plannedRecallSeconds: 300, plannedTutorSeconds: 900, dueCardsAtStart: 100 });
    expect(hundred).toMatchObject({ plannedRecallCards: 75, plannedRecallSeconds: 1500, plannedTutorSeconds: 4500 });
    context.repository.practice.updateSettings({ ...context.repository.practice.getSettings(), newItemsPerDay: 3 });
    expect(pilot().store.homework(twenty.homeworkId).settingsSnapshot.scheduler.newItemsPerDay).toBe(10);
    expect(pilot().homework.create({ homeworkId: twenty.homeworkId, requestedMinutes: 20, timezone: "Europe/Riga" }, now)).toEqual(twenty);
  });

  it("reserves Like time first, never assigns a request twice, and excludes only selected Likes", () => {
    for (let n = 0; n < 20; n++) due(card().publicId);
    const one = card(); const two = card(); listen(one.publicId, 1); like(one.publicId); like(two.publicId);
    const plan = homework();
    expect(plan).toMatchObject({ plannedRecallCards: 13, plannedRecallSeconds: 260, plannedTutorSeconds: 900 });
    expect(plan.plannedTutorRequestIds).toHaveLength(2);
    expect(plan.plannedCardIds).not.toContain(one.publicId);
    expect(homework().plannedTutorRequestIds).toHaveLength(0);
    pilot().homework.cancel(plan.homeworkId, later(20));
    expect(homework().plannedTutorRequestIds).toHaveLength(2);
  });

  it("allows Tutor-only without fake Recall or return and completes only with feedback", () => {
    const item = card(); like(item.publicId);
    const plan = homework();
    expect(plan).toMatchObject({ status: "tutor_in_progress", plannedRecallCards: 0, actualRecallSeconds: 0, returnedToTutorAt: null });
    const payload = pilot().tutor.receive(plan.homeworkId, plan.tutorChatId, now);
    expect(payload.cards[0]).toMatchObject({ source: "listen_like", attempts: [], latestRating: null, eligibleForContextPractice: true });
    expect(pilot().listening.pending()).toHaveLength(1);
    const feedback = { difficulty: "about_right", timeFit: "as_expected", nextStepClarity: "yes" } as const;
    expect(() => pilot().homework.feedback(plan.homeworkId, feedback)).toThrow("HOMEWORK_NOT_AWAITING_FEEDBACK");
    pilot().homework.finish(plan.homeworkId, later(50)); context.reopen();
    expect(pilot().store.homework(plan.homeworkId).status).toBe("awaiting_feedback");
    expect(pilot().homework.feedback(plan.homeworkId, feedback, later(60)).status).toBe("completed");
    expect(pilot().homework.feedback(plan.homeworkId, feedback, later(70)).status).toBe("completed");
  });

  it("resolves Like only after a saved card-specific activity and linked saved user response", () => {
    const item = card(); like(item.publicId);
    const plan = homework();
    const thread = context.repository.tutor.getThread(plan.tutorChatId)!;
    const startMessage = context.repository.tutor.addMessage(thread.id, "user", "Начнём");
    pilot().tutor.attachUser(plan.homeworkId, startMessage, true);
    const explanation = pilot().tutor.saveReply({ homeworkId: plan.homeworkId, userMessageId: startMessage,
      content: "Эта фраза значит…", activities: [{ cardId: item.publicId, activityType: "explanation", exerciseType: null }],
      respondedToMessageIds: [], metadata: {} }, now);
    expect(pilot().listening.pending()).toHaveLength(1);
    const response = context.repository.tutor.addMessage(thread.id, "user", "Теперь понятно.");
    pilot().tutor.attachUser(plan.homeworkId, response, false);
    pilot().tutor.saveReply({ homeworkId: plan.homeworkId, userMessageId: response, content: "Хорошо.",
      activities: [], respondedToMessageIds: [explanation], metadata: {} }, later(30));
    expect(pilot().listening.pending()).toHaveLength(0);
    expect(context.repository.items.get(item.publicId)?.preference).toBe("like");
    pilot().homework.cancel(plan.homeworkId);
    expect(homework().plannedTutorRequestIds).toHaveLength(0);
  });

  it("never imports foreign-language or orphan/hidden cards into pilot queues", () => {
    const foreign = card(randomUUID(), "lv");
    expect(() => listen(foreign.publicId)).toThrow("PILOT_CARD_NOT_FOUND");
    const orphan = context.repository.items.save({ language: "en", cue: "Без темы", target: "Orphan" });
    due(orphan.publicId);
    const hidden = card(); due(hidden.publicId);
    context.repository.items.update(hidden.publicId, { practiceEnabled: false });
    expect(pilot().queue.list({}, now)).toHaveLength(0);
  });

  it("uses the whole database beyond 2000 cards", () => {
    const topic = context.repository.library.createIsland({ language: "en", title: "Large pilot library" });
    context.db.transaction(() => {
      for (let n = 0; n < 2005; n++) context.repository.items.create({ publicId: `large-${n}`, language: "en", cue: `${n}`, target: `${n}` }, topic.publicId);
      due("large-2004");
    })();
    expect(pilot().queue.list({}, now).map((item) => item.publicId)).toEqual(["large-2004"]);
  });

  it("stops initiating Recall on budget exhaustion, but accepts the already started attempt", () => {
    const item = card(); due(item.publicId);
    const plan = homework(); const attempt = start(item.publicId, 0, plan.homeworkId);
    pilot().timing.record(plan.homeworkId, { eventId: randomUUID(), stage: "recall", measurementLost: false,
      intervals: [{ start: now, end: later(21) }] }, later(21));
    expect(pilot().queue.list({ homeworkId: plan.homeworkId }, later(21))).toHaveLength(0);
    expect(pilot().recall.grade(grade(attempt, "good", 22), later(22)).successfulRecallCount).toBe(2);
  });

  it("dedupes and unions active intervals, excludes feedback, and preserves missing measurements as null", () => {
    const item = card(); like(item.publicId); const plan = homework();
    const time = { eventId: randomUUID(), stage: "tutor" as const, intervals: [{ start: now, end: later(10) }], measurementLost: false };
    pilot().timing.record(plan.homeworkId, time, later(10)); pilot().timing.record(plan.homeworkId, time, later(10));
    expect(pilot().timing.record(plan.homeworkId, { ...time, eventId: randomUUID(), intervals: [{ start: later(5), end: later(15) }] }, later(15)).actualTutorSeconds).toBe(15);
    expect(() => pilot().timing.record(plan.homeworkId, { ...time, eventId: randomUUID(), intervals: [{ start: now, end: later(130) }] }, later(130))).toThrow("INVALID_ACTIVE_INTERVAL");
    expect(pilot().timing.record(plan.homeworkId, { ...time, eventId: randomUUID(), intervals: [], measurementLost: true }, later(16)).actualTutorSeconds).toBeNull();
    pilot().homework.finish(plan.homeworkId, later(17));
    expect(() => pilot().timing.record(plan.homeworkId, { ...time, eventId: randomUUID() }, later(20))).toThrow("HOMEWORK_STAGE_FINISHED");
  });
  it("enforces the new-card limit across Homework and standalone attempts using the saved local day", () => {
    const first = card(); const second = card(); listen(first.publicId); listen(second.publicId);
    context.repository.practice.updateSettings({ ...context.repository.practice.getSettings(), newItemsPerDay: 1 });
    const plan = homework(); expect(plan.plannedRecallCards).toBe(1);
    const chosen = plan.plannedCardIds[0]; const other = chosen === first.publicId ? second.publicId : first.publicId;
    // The second tab starts before the first grade; server rechecks on commit.
    const parallel = start(other);
    pilot().recall.grade(grade(start(chosen, 0, plan.homeworkId)), later(20));
    expect(() => pilot().recall.grade(grade(parallel), later(21))).toThrow("DAILY_NEW_CARD_LIMIT");
    expect(pilot().queue.list({ timezone: "Pacific/Honolulu" }, later(22))).toHaveLength(0);
    expect(pilot().queue.list({}, later(86400)).some((item) => item.publicId === other)).toBe(true);
  });

  it("limits accepted repeats to two per Homework, with no early Again return", () => {
    const item = card(); due(item.publicId); const plan = homework();
    const first = pilot().recall.grade(grade(start(item.publicId, 0, plan.homeworkId), "again"), later(20));
    expect(pilot().queue.list({ homeworkId: plan.homeworkId }, later(21))).toHaveLength(0);
    const dueAt = first.fsrsStateAfter!.dueAt;
    const secondId = randomUUID();
    pilot().recall.begin({ attemptId: secondId, cardId: item.publicId, homeworkId: plan.homeworkId, shownAt: dueAt, timezone: "Europe/Riga" }, dueAt);
    pilot().recall.grade({ ...grade(secondId, "again"), revealedAt: dueAt, ratedAt: dueAt, responseTimeMs: 0 }, dueAt);
    expect(pilot().queue.list({ homeworkId: plan.homeworkId }, later(86400))).toHaveLength(0);
  });

  it("exposes every old and new like as a derived collection without changing Topic ownership", () => {
    const old = card(); const fresh = card(); context.repository.items.updatePreference(old.publicId, "like"); like(fresh.publicId);
    expect(new Set(pilot().queue.liked(now).items.map((item) => item.publicId))).toEqual(new Set([old.publicId, fresh.publicId]));
    expect(context.repository.library.listIslands("en").some((topic) => topic.publicId === "liked")).toBe(false);
    like(fresh.publicId, false, 5);
    expect(pilot().queue.liked(now).items.map((item) => item.publicId)).toEqual([old.publicId]);
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM island_items ii JOIN items i ON i.id=ii.item_id WHERE i.public_id=?").get(fresh.publicId)).toEqual({ n: 1 });
  });

  it("cancels Homework on chat deletion while retaining its analytics and releasing pending requests", () => {
    const item = card(); like(item.publicId); const plan = homework();
    expect(pilot().homework.deleteChat(plan.tutorChatId)).toBe(true);
    expect(pilot().store.homework(plan.homeworkId).status).toBe("cancelled");
    expect(homework().plannedTutorRequestIds).toEqual(plan.plannedTutorRequestIds);
  });

  it("freezes standalone scheduling settings at the start of the attempt", () => {
    const item = card(); listen(item.publicId); const attempt = start(item.publicId);
    const snapshot = JSON.parse(pilot().recall.get(attempt)!.settings_snapshot);
    context.repository.practice.updateSettings({ ...context.repository.practice.getSettings(), learningSteps: ["20m"] });
    expect(JSON.parse(pilot().recall.get(attempt)!.settings_snapshot)).toEqual(snapshot);
    expect(pilot().recall.grade(grade(attempt), later(20)).fsrsStateAfter?.repetitions).toBe(1);
  });

});
