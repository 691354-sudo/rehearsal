import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
  type Grade,
  type RecordLogItem,
  type StepUnit,
} from "ts-fsrs";
import type { ItemPreference } from "../types.js";

export type ReviewRating = "again" | "hard" | "good" | "easy";
export type ReviewState = "new" | "learning" | "review" | "relearning";

export type StoredReviewState = {
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  repetitions: number;
  lapses: number;
  state: number;
  lastReview: string | null;
};

export type ReviewSchedule = {
  state: ReviewState;
  dueAt: string;
  retrievability: number | null;
  options: Record<ReviewRating, { dueAt: string; intervalSeconds: number }>;
};

export type SchedulerSettings = {
  presets: Record<ItemPreference, {
    requestRetention: number;
    maximumInterval: number;
  }>;
  learningSteps: StepUnit[];
  relearningSteps: StepUnit[];
  fuzz: boolean;
  newItemsPerDay: number;
};

export const defaultSchedulerSettings: SchedulerSettings = {
  presets: {
  like: { requestRetention: 0.93, maximumInterval: 60 },
  neutral: { requestRetention: 0.9, maximumInterval: 180 },
  dislike: { requestRetention: 0.87, maximumInterval: 365 },
  },
  learningSteps: ["1m", "10m"],
  relearningSteps: ["1m", "10m"],
  fuzz: true,
  newItemsPerDay: 10,
};

const isStep = (value: unknown): value is StepUnit =>
  typeof value === "string" && /^\d+(?:\.\d+)?[mhd]$/.test(value);

export const normalizeSchedulerSettings = (value: unknown): SchedulerSettings => {
  const input = value && typeof value === "object" ? value as Partial<SchedulerSettings> : {};
  const presets = (input.presets && typeof input.presets === "object" ? input.presets : {}) as
    Partial<SchedulerSettings["presets"]>;
  const preferenceSettings = (preference: ItemPreference) => {
    const fallback = defaultSchedulerSettings.presets[preference];
    const candidate = presets[preference];
    return {
      requestRetention: typeof candidate?.requestRetention === "number"
        ? Math.min(0.97, Math.max(0.8, candidate.requestRetention))
        : fallback.requestRetention,
      maximumInterval: typeof candidate?.maximumInterval === "number"
        ? Math.min(3650, Math.max(7, Math.round(candidate.maximumInterval)))
        : fallback.maximumInterval,
    };
  };
  const normalizeSteps = (steps: unknown, fallback: StepUnit[]) =>
    Array.isArray(steps) && steps.length > 0 && steps.length <= 4 && steps.every(isStep)
      ? [...steps] : fallback;
  return {
    presets: {
      like: preferenceSettings("like"),
      neutral: preferenceSettings("neutral"),
      dislike: preferenceSettings("dislike"),
    },
    learningSteps: normalizeSteps(input.learningSteps, defaultSchedulerSettings.learningSteps),
    relearningSteps: normalizeSteps(input.relearningSteps, defaultSchedulerSettings.relearningSteps),
    fuzz: typeof input.fuzz === "boolean" ? input.fuzz : defaultSchedulerSettings.fuzz,
    newItemsPerDay: typeof input.newItemsPerDay === "number"
      ? Math.min(30, Math.max(0, Math.round(input.newItemsPerDay)))
      : defaultSchedulerSettings.newItemsPerDay,
  };
};

const engineCache = new Map<string, ReturnType<typeof fsrs>>();

const getEngine = (preference: ItemPreference, settings: SchedulerSettings) => {
  const preset = settings.presets[preference];
  const key = JSON.stringify([preference, preset, settings.learningSteps, settings.relearningSteps, settings.fuzz]);
  const cached = engineCache.get(key);
  if (cached) return cached;
  const engine = fsrs({
    request_retention: preset.requestRetention,
    maximum_interval: preset.maximumInterval,
    enable_fuzz: settings.fuzz,
    enable_short_term: true,
    learning_steps: settings.learningSteps,
    relearning_steps: settings.relearningSteps,
  });
  engineCache.set(key, engine);
  return engine;
};

const ratings: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const stateNames: Record<State, ReviewState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const maximumDue = (now: Date, preference: ItemPreference, settings: SchedulerSettings) =>
  new Date(now.getTime() + settings.presets[preference].maximumInterval * 86_400_000);

const capDueDate = (due: Date, now: Date, preference: ItemPreference, settings: SchedulerSettings) => {
  const maximum = maximumDue(now, preference, settings);
  return due > maximum ? maximum : due;
};

const parseStoredDate = (value: string) => {
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
};

export const cardFromStoredState = (
  stored: StoredReviewState | undefined,
  now: Date,
): Card => {
  if (!stored) return createEmptyCard(now);
  return {
    due: parseStoredDate(stored.dueAt),
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    learning_steps: stored.learningSteps,
    reps: stored.repetitions,
    lapses: stored.lapses,
    state: stored.state as State,
    last_review: stored.lastReview ? parseStoredDate(stored.lastReview) : undefined,
  };
};

export const storedStateFromCard = (card: Card): StoredReviewState => ({
  dueAt: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsedDays: card.elapsed_days,
  scheduledDays: card.scheduled_days,
  learningSteps: card.learning_steps,
  repetitions: card.reps,
  lapses: card.lapses,
  state: card.state,
  lastReview: card.last_review?.toISOString() || null,
});

export const previewReview = (
  card: Card,
  now: Date,
  preference: ItemPreference = "neutral",
  settings: SchedulerSettings = defaultSchedulerSettings,
): ReviewSchedule => {
  const engine = getEngine(preference, settings);
  const preview = engine.repeat(card, now);
  const option = (rating: Grade) => {
    const due = capDueDate(preview[rating].card.due, now, preference, settings);
    return {
      dueAt: due.toISOString(),
      intervalSeconds: Math.max(0, Math.round(
        (due.getTime() - now.getTime()) / 1000,
      )),
    };
  };
  return {
    state: stateNames[card.state],
    dueAt: card.due.toISOString(),
    retrievability: card.state === State.Review
      ? engine.get_retrievability(card, now, false)
      : null,
    options: {
      again: option(Rating.Again),
      hard: option(Rating.Hard),
      good: option(Rating.Good),
      easy: option(Rating.Easy),
    },
  };
};

export const scheduleReview = (
  card: Card,
  rating: ReviewRating,
  now: Date,
  preference: ItemPreference = "neutral",
  settings: SchedulerSettings = defaultSchedulerSettings,
): RecordLogItem => {
  const result = getEngine(preference, settings).next(card, now, ratings[rating]);
  const due = capDueDate(result.card.due, now, preference, settings);
  if (due.getTime() === result.card.due.getTime()) return result;
  return {
    ...result,
    card: {
      ...result.card,
      due,
      scheduled_days: settings.presets[preference].maximumInterval,
    },
  };
};
