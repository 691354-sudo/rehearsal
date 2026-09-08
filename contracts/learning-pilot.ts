import type { LearningItem, ReviewRating, SchedulerSettings } from "./api.js";

export const pilotDefaults = {
  experimentVersion: "echo-learning-pilot-v1",
  schedulerVersion: "ts-fsrs-5.4.1/FSRS-6",
  listenAppearancesForRecall: 5,
  successfulRecallsForTutor: 2,
  desiredRetention: 0.90,
  estimatedRecallSeconds: 20,
  estimatedTutorSecondsPerCard: 60,
  maxRecallAttemptsPerCardPerHomework: 2,
  recentListenWindowSeconds: 600,
  idleTimeoutSeconds: 120,
} as const;
export type PilotSettings = { [K in keyof typeof pilotDefaults]:
  typeof pilotDefaults[K] extends string ? string : number } & { scheduler: SchedulerSettings };
export const likedTopicId = "liked";
export type PilotInputMode = "oral_self_check" | "typed" | "voice_optional";
export type QueueReason = "due" | "new_after_listen_threshold";
export type PilotCard = LearningItem & {
  listenCount: number;
  recallEligibleAt: string | null;
  successfulRecallCount: number;
  hasRecallHistory: boolean;
  queueReason: QueueReason;
};
export type ListenAppearance = {
  eventId: string;
  language: "en";
  cardId: string;
  listenSessionId: string;
  appearanceId: string;
  completedAt: string;
  audioRepeatsInAppearance: number;
};
export type ListenLike = {
  eventId: string;
  language: "en";
  cardId: string;
  liked: boolean;
  occurredAt: string;
};
export type PriorityRequest = {
  tutorRequestId: string;
  cardId: string;
  source: "listen_like";
  requestedAt: string;
  status: "pending" | "resolved" | "cancelled";
  resolvedAt: string | null;
  cancelledAt: string | null;
  homeworkId: string | null;
};
export type HomeworkStatus = "recall_in_progress" | "tutor_in_progress"
  | "awaiting_feedback" | "completed" | "cancelled";
export type HomeworkFeedback = {
  difficulty: "too_easy" | "about_right" | "too_hard";
  timeFit: "shorter" | "as_expected" | "longer";
  nextStepClarity: "yes" | "not_always" | "no";
  tutorHelpfulness?: "yes" | "partly" | "no" | "didnt_reach_tutor";
  obstacleText?: string;
  requestedPracticeText?: string;
};
export type Homework = {
  homeworkId: string;
  tutorChatId: string;
  language: "en";
  requestedMinutes: number;
  plannedRecallCards: number;
  plannedRecallSeconds: number;
  plannedTutorSeconds: number;
  plannedCardIds: string[];
  plannedTutorRequestIds: string[];
  settingsSnapshot: PilotSettings;
  dueCardsAtStart: number;
  actualRecallSeconds: number | null;
  actualTutorSeconds: number | null;
  startedAt: string;
  timezone?: string;
  recallFinishedAt: string | null;
  returnedToTutorAt: string | null;
  tutorFinishedAt: string | null;
  endedAt: string | null;
  status: HomeworkStatus;
  continued: boolean;
  feedback: HomeworkFeedback | null;
};
export type HomeworkSummary = Pick<Homework, "homeworkId" | "tutorChatId" | "startedAt" | "status"> & { title: string };
export const homeworkTitle = (homework: Pick<Homework, "startedAt" | "timezone">) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: homework.timezone || "UTC",
    day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date(homework.startedAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value("day")}.${value("month")}.${value("year")} - Homework`;
};
export type PilotAttemptStart = {
  attemptId: string;
  cardId: string;
  homeworkId?: string;
  shownAt: string;
  timezone: string;
};
export type PilotAttemptGrade = {
  attemptId: string;
  revealedAt: string;
  ratedAt: string;
  responseTimeMs: number | null;
  rating: ReviewRating;
  inputMode: PilotInputMode;
  answer: string;
};
export type HomeworkTime = {
  eventId: string;
  stage: "recall" | "tutor";
  intervals: Array<{ start: string; end: string }>;
  measurementLost: boolean;
};
export type HomeworkTutorCard = {
  cardId: string;
  cue: string;
  targetPhrase: string;
  translation: string;
  latestRating: ReviewRating | null;
  source: "listen_like" | "recall_result";
  tutorRequestId: string | null;
  successfulRecallCount: number;
  eligibleForContextPractice: boolean;
  attempts: Array<{ attemptId: string; rating: ReviewRating; ratedAt: string; inputMode: PilotInputMode }>;
};
export type HomeworkTutorContext = {
  homeworkId: string;
  tutorChatId: string;
  userId: string;
  language: "en";
  nativeLanguage: "ru";
  requestedMinutes: number;
  actualRecallSeconds: number | null;
  actualTutorSeconds: number | null;
  remainingSeconds: number | null;
  cards: HomeworkTutorCard[];
};
export type TutorActivity = {
  cardId: string;
  activityType: "explanation" | "exercise";
  exerciseType: string | null;
};
