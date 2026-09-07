import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";
import { pilotMetrics } from "../../services/pilot-metrics.js";
import type { ReviewRating } from "../../../contracts/api.js";

const start = "2026-09-07T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString();
describe("pilot export and seven-day metrics", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); context.db.prepare("DELETE FROM items").run(); });
  afterEach(() => context.close());
  const add = (id: string, old = false) => {
    const topic = context.repository.library.createIsland({ language: "en", title: id });
    const item = context.repository.items.create({ publicId: id, language: "en", cue: `Фраза ${id}`, target: `Phrase ${id}.` }, topic.publicId);
    if (old) context.repository.practice.recordAttempt({ itemPublicId: id, mode: "recall", answer: "", score: 1, verdict: "easy", rating: "easy", feedback: {}, reviewedAt: new Date("2020-01-01T00:00:00.000Z") });
    return item;
  };
  const recall = (cardId: string, rating: ReviewRating, seconds: number, homeworkId?: string) => {
    const attemptId = randomUUID();
    context.repository.pilot.recall.begin({ attemptId, cardId, homeworkId, shownAt: at(seconds), timezone: "Europe/Riga" }, at(seconds));
    return context.repository.pilot.recall.grade({ attemptId, rating, revealedAt: at(seconds + 1), ratedAt: at(seconds + 2), responseTimeMs: 2000, inputMode: "oral_self_check", answer: "" }, at(seconds + 2));
  };
  it("exports all datasets and truthful denominators for an empty window", () => {
    const pilot = context.repository.pilot;
    const participant = pilot.participants.start("Europe/Riga", start);
    pilot.participants.end(participant.participantId, at(604800));
    const report = pilot.export.report(start, at(604800));
    expect(Object.keys(report.datasets)).toEqual(["pilot_participants", "listen_events", "tutor_priority_requests", "recall_attempts", "homework_sessions", "tutor_homework_sessions", "post_session_feedback", "cards_snapshot"]);
    expect(report.snapshotBoundaries).toHaveLength(2);
    expect(report.comparison.complete).toBe(true);
    const metrics = pilotMetrics(report);
    expect(metrics).toMatchObject({ uniqueCardsListened: 0, uniqueCardsRecalled: 0, dueBacklogStart: 0, dueBacklogEnd: 0,
      cardsReachedFiveListens: 0, avgRecallResponseTimeMs: null, medianRecallResponseTimeMs: null,
      cardsWithTwoSuccessfulRecalls: { end: 0, increase: 0, comparisonComplete: true },
      recallTimeShare: { numerator: 0, denominator: 0, value: null }, tutorTimeShare: { value: null },
      returnedToTutorRate: { value: null }, againCardsExplainedRate: { value: null }, hardCardsPracticedRate: { value: null },
      recentListenBeforeRecallRate: { value: null }, recentListenUnknownOrInvalidRate: { value: null },
      newEligibleButNotRecalled: 0, firstRecallCount: 0, sameCardRepeatedTooOften: [], dueCardsSkipped: [],
      likedCardsQueued: { requests: 0, distinctCards: 0 }, likedCardsDiscussed: { requests: 0 }, pendingLikedCards: { requests: 0 },
      likeToDiscussionMs: { values: [], average: null, median: null }, plannedVsActualHomeworkTime: [],
      userTutorEngagement: { userMessagesCount: 0, sessionsWithReply: { value: null } },
      tutorHelpfulnessFeedback: { missingCount: 0, unsubmittedSessions: 0 },
      againToGoodTransitions: { sameDay: { count: 0, cardIds: [] }, differentDay: { count: 0, cardIds: [] } } });
    for (const distribution of [metrics.ratingDistribution, metrics.queueReasonDistribution, metrics.tutorHelpfulnessFeedback.distribution]) {
      for (const value of Object.values(distribution)) expect(value).toEqual({ numerator: 0, denominator: 0, value: null });
    }
  });
  it("reproduces a fixed week with oral Recall, Like discussion, distinct-card completion and both transition days", () => {
    const pilot = context.repository.pilot;
    add("due", true); add("hard", true); add("fresh"); add("liked");
    const participant = pilot.participants.start("Europe/Riga", start);
    for (let n = 0; n < 5; n++) pilot.listening.complete({ eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(), cardId: "fresh", language: "en", completedAt: at(n + 1), audioRepeatsInAppearance: 3 }, at(n + 1));
    pilot.listening.like({ eventId: randomUUID(), cardId: "liked", language: "en", liked: true, occurredAt: at(6) }, at(6));
    const hw = pilot.homework.create({ homeworkId: randomUUID(), requestedMinutes: 20, timezone: "Europe/Riga" }, at(7));
    expect(hw.plannedRecallCards).toBe(3);
    recall("due", "again", 8, hw.homeworkId); recall("hard", "hard", 11, hw.homeworkId); recall("fresh", "again", 14, hw.homeworkId);
    recall("due", "good", 75, hw.homeworkId);
    pilot.timing.record(hw.homeworkId, { eventId: randomUUID(), stage: "recall", measurementLost: false, intervals: [{ start: at(7), end: at(47) }] }, at(80));
    pilot.homework.returnToTutor(hw.homeworkId, at(81));
    const tutorContext = pilot.tutor.receive(hw.homeworkId, hw.tutorChatId, at(82));
    expect(tutorContext.cards.find((card) => card.cardId === "fresh")?.eligibleForContextPractice).toBe(false);
    const thread = context.repository.tutor.getThread(hw.tutorChatId)!;
    const intro = context.repository.tutor.addMessage(thread.id, "user", "Начнём"); pilot.tutor.attachUser(hw.homeworkId, intro, true, at(82));
    const message = pilot.tutor.saveReply({ homeworkId: hw.homeworkId, userMessageId: intro, content: "Пример и упражнение.", metadata: {}, respondedToMessageIds: [], activities: [
      { cardId: "due", activityType: "explanation", exerciseType: null }, { cardId: "fresh", activityType: "explanation", exerciseType: null },
      { cardId: "liked", activityType: "exercise", exerciseType: "personal_example" }, { cardId: "hard", activityType: "exercise", exerciseType: "substitution" },
      { cardId: "fresh", activityType: "exercise", exerciseType: "roleplay" },
    ] }, at(85));
    const response = context.repository.tutor.addMessage(thread.id, "user", "Мой ответ"); pilot.tutor.attachUser(hw.homeworkId, response, false, at(90));
    pilot.tutor.saveReply({ homeworkId: hw.homeworkId, userMessageId: response, content: "Хорошо.", metadata: {}, activities: [], respondedToMessageIds: [message] }, at(95));
    pilot.timing.record(hw.homeworkId, { eventId: randomUUID(), stage: "tutor", measurementLost: false, intervals: [{ start: at(81), end: at(111) }] }, at(111));
    pilot.homework.finish(hw.homeworkId, at(112));
    pilot.homework.feedback(hw.homeworkId, { difficulty: "about_right", timeFit: "as_expected", nextStepClarity: "yes", tutorHelpfulness: "partly" }, at(115));
    recall("fresh", "easy", 86400);
    pilot.participants.end(participant.participantId, at(604800));
    const report = pilot.export.report(start, at(604800)); const metrics = pilotMetrics(report);
    expect(report.comparison.complete).toBe(true);
    expect(report.datasets.listen_events[4]).toMatchObject({ listenCountAfter: 5, becameRecallEligible: true, audioRepeatsInAppearance: 3, userId: report.userId, language: "en", appVersion: expect.any(String), experimentVersion: "echo-learning-pilot-v1" });
    expect(report.datasets.recall_attempts[2]).toMatchObject({ inputMode: "oral_self_check", responseTimeMs: 2000, lastListenAt: at(5), lastListenDeltaMs: 9000, dueBefore: null, dueAfter: expect.any(String), wasAnswerRevealedBeforeRating: true, queueReason: "new_after_listen_threshold", selectionSource: "homework_selected" });
    expect(report.datasets.homework_sessions[0]).toMatchObject({ status: "completed", finishedRecallCards: 3, skippedCards: [], returnedToTutor: true, againCards: ["due", "fresh"], hardCards: ["hard"], actualRecallSeconds: 40, actualTutorSeconds: 30, dueCardsSkipped: 0 });
    expect(report.datasets.tutor_homework_sessions[0]).toMatchObject({ cardsReceived: 4, explainedCards: ["due", "fresh"], practicedCards: ["hard", "liked"], userMessagesCount: 1 });
    expect(report.datasets.post_session_feedback[0]).toMatchObject({ obstacleText: null, requestedPracticeText: null, tutorHelpfulness: "partly" });
    expect(metrics).toMatchObject({ uniqueCardsListened: 1, cardsReachedFiveListens: 1, uniqueCardsRecalled: 3,
      cardsWithTwoSuccessfulRecalls: { end: 2, increase: 2 }, dueBacklogStart: 2,
      avgRecallResponseTimeMs: 2000, medianRecallResponseTimeMs: 2000, recallResponseTimeMissing: 0,
      recallTimeShare: { numerator: 40, denominator: 70, value: 4 / 7 }, tutorTimeShare: { value: 3 / 7 }, timeShareMissingSessions: 0,
      firstRecallCount: 1, newEligibleButNotRecalled: 0, sameCardRepeatedTooOften: [],
      recentListenBeforeRecallRate: { numerator: 1, denominator: 2, value: .5 }, recentListenUnknownOrInvalidRate: { numerator: 3, denominator: 5, value: .6 },
      returnedToTutorRate: { numerator: 1, denominator: 1, value: 1 }, againCardsExplainedRate: { numerator: 2, denominator: 2, value: 1 }, hardCardsPracticedRate: { numerator: 1, denominator: 1, value: 1 },
      likedCardsQueued: { requests: 1, distinctCards: 1 }, likedCardsDiscussed: { requests: 1, distinctCards: 1 }, pendingLikedCards: { requests: 0, distinctCards: 0 },
      likeToDiscussionMs: { average: 89000, median: 89000 },
      againToGoodTransitions: { sameDay: { count: 1, cardIds: ["due"] }, differentDay: { count: 1, cardIds: ["fresh"] } },
      ratingDistribution: { again: { numerator: 2, denominator: 5 }, hard: { numerator: 1 }, good: { numerator: 1 }, easy: { numerator: 1 } },
      queueReasonDistribution: { due: { numerator: 4, denominator: 5 }, new_after_listen_threshold: { numerator: 1, denominator: 5 } },
      userTutorEngagement: { userMessagesCount: 1, sessionsWithReply: { value: 1 } }, tutorHelpfulnessFeedback: { missingCount: 0, unsubmittedSessions: 0, distribution: { partly: { value: 1 } } } });
    expect(JSON.stringify(report)).not.toContain("Мой ответ");
    expect(JSON.stringify(report)).not.toContain("Phrase fresh");
  });
  it("reports missing boundaries, imported/deleted/changed cards and lost time without reconstruction", () => {
    const pilot = context.repository.pilot; add("removed"); add("changed");
    const p = pilot.participants.start("Europe/Riga", start);
    const hw = pilot.homework.create({ homeworkId: randomUUID(), requestedMinutes: 1, timezone: "Europe/Riga" }, at(1));
    pilot.timing.record(hw.homeworkId, { eventId: randomUUID(), stage: "tutor", measurementLost: true, intervals: [] }, at(2));
    pilot.homework.cancel(hw.homeworkId, at(3));
    context.repository.items.delete("removed"); add("imported"); context.repository.items.update("changed", { target: "Changed text." });
    pilot.participants.end(p.participantId, at(604800));
    const report = pilot.export.report(start, at(604800));
    expect(report.comparison).toEqual({ complete: false, missingStart: false, missingEnd: false, importedCardIds: ["imported"], deletedCardIds: ["removed"], changedCardIds: ["changed"] });
    expect(report.datasets.homework_sessions[0].actualTutorSeconds).toBeNull();
    expect(pilotMetrics(report)).toMatchObject({ timeShareMissingSessions: 1, recallTimeShare: { value: null }, returnedToTutorRate: { denominator: 0, value: null } });
    const partial = pilot.export.report(at(1), at(604799));
    expect(partial.comparison).toMatchObject({ missingStart: true, missingEnd: true });
    expect(pilotMetrics(partial)).toMatchObject({ dueBacklogStart: null, dueBacklogEnd: null, cardsWithTwoSuccessfulRecalls: { end: null, increase: null } });
  });
});
