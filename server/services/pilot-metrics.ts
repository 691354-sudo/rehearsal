import type { PilotReport } from "../../contracts/learning-pilot-analytics.js";
import { localDay } from "../db/pilot/store.js";

const unique = <T>(values: T[]) => [...new Set(values)];
const mean = (values: number[]) => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export const pilotRatio = (numerator: number, denominator: number) => ({ numerator, denominator,
  value: denominator ? numerator / denominator : null });
const distribution = <T extends string>(values: T[], choices: readonly T[]) => Object.fromEntries(
  choices.map((choice) => [choice, pilotRatio(values.filter((value) => value === choice).length, values.length)]));

export const pilotMetrics = (report: PilotReport) => {
  const { listen_events: listens, recall_attempts: attempts, homework_sessions: homework,
    tutor_homework_sessions: tutor, post_session_feedback: feedback, cards_snapshot: snapshots,
    tutor_priority_requests: requests } = report.datasets;
  const start = snapshots.filter((card) => card.snapshotKind === "start" && card.snapshotAt === report.period.startedAt);
  const end = snapshots.filter((card) => card.snapshotKind === "end" && card.snapshotAt === report.period.endedAt);
  const startKnown = !report.comparison.missingStart;
  const endKnown = !report.comparison.missingEnd;
  const twoStart = start.filter((card) => card.successfulRecallCount >= 2).length;
  const twoEnd = end.filter((card) => card.successfulRecallCount >= 2).length;
  const sameDay = new Set<string>(); const differentDay = new Set<string>();
  for (const cardId of unique(attempts.map((attempt) => attempt.cardId))) {
    const rows = attempts.filter((attempt) => attempt.cardId === cardId).sort((a, b) => a.ratedAt.localeCompare(b.ratedAt));
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].rating !== "again") continue;
      for (const later of rows.slice(index + 1)) {
        if (!["good", "easy"].includes(later.rating) || later.ratedAt <= rows[index].ratedAt) continue;
        (localDay(rows[index].ratedAt, report.timezone) === localDay(later.ratedAt, report.timezone)
          ? sameDay : differentDay).add(cardId);
      }
    }
  }
  const responseTimes = attempts.flatMap((attempt) => attempt.responseTimeMs === null ? [] : [attempt.responseTimeMs]);
  const measured = homework.filter((session) => session.actualRecallSeconds !== null && session.actualTutorSeconds !== null);
  const recallSeconds = measured.reduce((sum, session) => sum + session.actualRecallSeconds!, 0);
  const tutorSeconds = measured.reduce((sum, session) => sum + session.actualTutorSeconds!, 0);
  const knownListen = attempts.filter((attempt) => attempt.lastListenDeltaMs !== null && Number.isFinite(attempt.lastListenDeltaMs) && attempt.lastListenDeltaMs >= 0);
  const recentListen = knownListen.filter((attempt) => attempt.lastListenDeltaMs!
    <= (attempt.settingsSnapshot.recentListenWindowSeconds
      ?? report.settings.recentListenWindowSeconds) * 1000);
  const pairs = new Map<string, { homeworkId: string; cardId: string; attempts: number }>();
  for (const attempt of attempts) {
    if (!attempt.homeworkId) continue;
    const key = `${attempt.homeworkId}:${attempt.cardId}`;
    const current = pairs.get(key) ?? { homeworkId: attempt.homeworkId, cardId: attempt.cardId, attempts: 0 };
    current.attempts += 1; pairs.set(key, current);
  }
  const stoppedRecall = homework.filter((session) => session.recallStarted && session.plannedRecallCards > 0 && session.recallFinishedAt !== null);
  const again = homework.flatMap((session) => session.againCards.map((cardId) => `${session.homeworkId}:${cardId}`));
  const explained = new Set(tutor.flatMap((session) => session.explainedCards.map((cardId) => `${session.homeworkId}:${cardId}`)));
  const eligibleHard = tutor.flatMap((session) => session.hardCards.filter((cardId) => session.contextPracticeEligibleCardIds.includes(cardId))
    .map((cardId) => `${session.homeworkId}:${cardId}`));
  const practiced = new Set(tutor.flatMap((session) => session.practicedCards.map((cardId) => `${session.homeworkId}:${cardId}`)));
  const queued = requests.filter((request) => request.requestedAt >= report.period.startedAt && request.requestedAt < report.period.endedAt);
  const discussed = requests.filter((request) => request.resolvedAt && request.resolvedAt >= report.period.startedAt && request.resolvedAt < report.period.endedAt);
  const pending = requests.filter((request) => request.status === "pending");
  const discussionTimes = discussed.map((request) => ({ tutorRequestId: request.tutorRequestId, cardId: request.cardId,
    milliseconds: Date.parse(request.resolvedAt!) - Date.parse(request.requestedAt) }));
  const helpfulness = feedback.flatMap((entry) => entry.tutorHelpfulness ? [entry.tutorHelpfulness] : []);
  return {
    uniqueCardsListened: unique(listens.map((event) => event.cardId)).length,
    cardsReachedFiveListens: unique(listens.filter((event) => event.becameRecallEligible).map((event) => event.cardId)).length,
    uniqueCardsRecalled: unique(attempts.map((attempt) => attempt.cardId)).length,
    cardsWithTwoSuccessfulRecalls: { end: endKnown ? twoEnd : null, increase: startKnown && endKnown ? twoEnd - twoStart : null,
      comparisonComplete: report.comparison.complete },
    ratingDistribution: distribution(attempts.map((attempt) => attempt.rating), ["again", "hard", "good", "easy"] as const),
    againToGoodTransitions: { sameDay: { count: sameDay.size, cardIds: [...sameDay] }, differentDay: { count: differentDay.size, cardIds: [...differentDay] } },
    dueBacklogStart: startKnown ? start.filter((card) => card.isActive && card.hasRecallHistory && card.due && card.due <= card.snapshotAt).length : null,
    dueBacklogEnd: endKnown ? end.filter((card) => card.isActive && card.hasRecallHistory && card.due && card.due <= card.snapshotAt).length : null,
    avgRecallResponseTimeMs: mean(responseTimes), medianRecallResponseTimeMs: median(responseTimes),
    recallResponseTimeMissing: attempts.length - responseTimes.length,
    plannedVsActualHomeworkTime: homework.map((session) => ({ homeworkId: session.homeworkId,
      requestedSeconds: session.requestedMinutes * 60, plannedRecallSeconds: session.plannedRecallSeconds,
      plannedTutorSeconds: session.plannedTutorSeconds, actualRecallSeconds: session.actualRecallSeconds,
      actualTutorSeconds: session.actualTutorSeconds, status: session.status, partial: session.status !== "completed" })),
    recallTimeShare: pilotRatio(recallSeconds, recallSeconds + tutorSeconds), tutorTimeShare: pilotRatio(tutorSeconds, recallSeconds + tutorSeconds),
    timeShareMissingSessions: homework.length - measured.length,
    queueReasonDistribution: distribution(attempts.map((attempt) => attempt.queueReason), ["due", "new_after_listen_threshold"] as const),
    recentListenBeforeRecallRate: pilotRatio(recentListen.length, knownListen.length),
    recentListenUnknownOrInvalidRate: pilotRatio(attempts.length - knownListen.length, attempts.length),
    firstRecallCount: attempts.filter((attempt) => attempt.queueReason === "new_after_listen_threshold").length,
    sameCardRepeatedTooOften: [...pairs.values()].filter((pair) => pair.attempts
      > (homework.find((session) => session.homeworkId === pair.homeworkId)?.settingsSnapshot.maxRecallAttemptsPerCardPerHomework
        ?? report.settings.maxRecallAttemptsPerCardPerHomework)),
    newEligibleButNotRecalled: endKnown ? end.filter((card) => card.isActive && card.recallEligibleAt && !card.hasRecallHistory).length : null,
    dueCardsSkipped: homework.map((session) => ({ homeworkId: session.homeworkId, count: session.dueCardsSkipped })),
    returnedToTutorRate: pilotRatio(stoppedRecall.filter((session) => session.returnedToTutorAt !== null).length, stoppedRecall.length),
    againCardsExplainedRate: pilotRatio(again.filter((key) => explained.has(key)).length, again.length),
    hardCardsPracticedRate: pilotRatio(eligibleHard.filter((key) => practiced.has(key)).length, eligibleHard.length),
    userTutorEngagement: { userMessagesCount: tutor.reduce((sum, session) => sum + session.userMessagesCount, 0),
      sessionsWithReply: pilotRatio(tutor.filter((session) => session.userMessagesCount > 0).length, tutor.length) },
    tutorHelpfulnessFeedback: { distribution: distribution(helpfulness, ["yes", "partly", "no", "didnt_reach_tutor"] as const),
      missingCount: feedback.length - helpfulness.length, unsubmittedSessions: homework.filter((session) => !feedback.some((entry) => entry.homeworkId === session.homeworkId)).length },
    likedCardsQueued: { requests: queued.length, distinctCards: unique(queued.map((request) => request.cardId)).length },
    likedCardsDiscussed: { requests: discussed.length, distinctCards: unique(discussed.map((request) => request.cardId)).length },
    pendingLikedCards: { requests: pending.length, distinctCards: unique(pending.map((request) => request.cardId)).length },
    likeToDiscussionMs: { values: discussionTimes, average: mean(discussionTimes.map((entry) => entry.milliseconds)), median: median(discussionTimes.map((entry) => entry.milliseconds)) },
  };
};
