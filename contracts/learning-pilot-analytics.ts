import type { ReviewRating } from "./api.js";
import type { Homework, HomeworkFeedback, HomeworkTutorContext, PilotInputMode, PriorityRequest, QueueReason } from "./learning-pilot.js";

export type PilotCommon = { userId: string; language: "en"; appVersion: string; experimentVersion: string };
export type PilotEventCommon = PilotCommon & { eventId: string; createdAt: string };
export type PilotParticipant = PilotCommon & {
  participantId: string; nativeLanguage: "ru"; startedAt: string; endedAt: string | null;
  scheduledEndAt: string; timezone: string;
};
export type FsrsSnapshot = {
  dueAt: string; stability: number; difficulty: number; elapsedDays: number; scheduledDays: number;
  learningSteps: number; repetitions: number; lapses: number; state: number; lastReview: string | null;
};
export type PilotCardSnapshot = {
  cardId: string; listenCount: number; recallEligibleAt: string | null; hasRecallHistory: boolean;
  successfulRecallCount: number; lastRating: ReviewRating | null; due: string | null;
  fsrsState: FsrsSnapshot | null; isActive: boolean; pendingTutorRequestId: string | null;
  contentFingerprint: string;
};
export type ExportedSnapshot = PilotCommon & PilotCardSnapshot & {
  participantId: string; snapshotAt: string; snapshotKind: "start" | "end";
};
export type ExportedListen = PilotEventCommon & {
  listenSessionId: string; appearanceId: string; cardId: string; completedAt: string;
  listenCountAfter: number; becameRecallEligible: boolean; audioRepeatsInAppearance: number;
};
export type ExportedAttempt = PilotEventCommon & {
  settingsSnapshot: import("./learning-pilot.js").PilotSettings;
  attemptId: string; cardId: string; homeworkId: string | null; shownAt: string;
  revealedAt: string; ratedAt: string; responseTimeMs: number | null; rating: ReviewRating;
  inputMode: PilotInputMode; lastListenAt: string | null; fsrsStateBefore: FsrsSnapshot | null;
  fsrsStateAfter: FsrsSnapshot | null; queueReason: QueueReason;
  selectionSource: "homework_selected" | "standalone"; wasAnswerRevealedBeforeRating: boolean;
  lastListenDeltaMs: number | null; dueBefore: string | null; dueAfter: string | null;
};
export type ExportedHomework = PilotEventCommon & Omit<Homework, "feedback"> & {
  recallStarted: boolean;
  finishedRecallCards: number; skippedCards: string[]; returnedToTutor: boolean | null;
  againCards: string[]; hardCards: string[]; dueCardsSkipped: number;
};
export type ExportedTutor = PilotEventCommon & {
  homeworkId: string; tutorChatId: string; receivedCardIds: string[]; contextPracticeEligibleCardIds: string[];
  completedAt: string | null; cardsReceived: number; againCards: string[]; hardCards: string[];
  explainedCards: string[]; practicedCards: string[]; exerciseTypesUsed: string[]; userMessagesCount: number;
  activities: Array<{ cardId: string; activityType: "explanation" | "exercise"; exerciseType: string | null;
    messageId: number; userResponseMessageId: number | null; createdAt: string }>;
};
export type ExportedFeedback = PilotEventCommon & {
  homeworkId: string; submittedAt: string; difficulty: HomeworkFeedback["difficulty"];
  timeFit: HomeworkFeedback["timeFit"]; nextStepClarity: HomeworkFeedback["nextStepClarity"];
  tutorHelpfulness: NonNullable<HomeworkFeedback["tutorHelpfulness"]> | null;
  obstacleText: string | null; requestedPracticeText: string | null;
};
export type PilotDatasets = {
  pilot_participants: PilotParticipant[];
  listen_events: ExportedListen[];
  tutor_priority_requests: Array<PilotEventCommon & PriorityRequest>;
  recall_attempts: ExportedAttempt[];
  homework_sessions: ExportedHomework[];
  tutor_homework_sessions: ExportedTutor[];
  post_session_feedback: ExportedFeedback[];
  cards_snapshot: ExportedSnapshot[];
};
export type PilotReport = {
  userId: string; language: "en"; period: { startedAt: string; endedAt: string }; timezone: string;
  settings: { recentListenWindowSeconds: number; maxRecallAttemptsPerCardPerHomework: number };
  datasets: PilotDatasets;
  likeEvents: Array<PilotEventCommon & { cardId: string; liked: boolean; occurredAt: string }>;
  snapshotBoundaries: Array<{ participantId: string; snapshotAt: string; snapshotKind: "start" | "end" }>;
  comparison: { complete: boolean; missingStart: boolean; missingEnd: boolean;
    importedCardIds: string[]; deletedCardIds: string[]; changedCardIds: string[] };
};
export type TutorSessionRow = { homework_id: string; received_at: string; completed_at: string | null; context: string };
export type StoredTutorContext = HomeworkTutorContext;
