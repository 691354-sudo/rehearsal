import type { RehearsalDatabase } from "../database.js";
import type {
  LanguageCode,
  LearningItem,
  ReviewBatch,
  ReviewBatchKind,
  ReviewCandidate,
} from "../../types.js";
import type { StoredReviewState } from "../../services/scheduler.js";

export type ItemRow = {
  id: number;
  public_id: string;
  language_code: LanguageCode;
  kind: LearningItem["kind"];
  cue: string;
  target: string;
  accepted_answers: string;
  note: string;
  source: string;
  status: LearningItem["status"];
  preference: LearningItem["preference"];
  naturalness: number;
  commonness: number;
  register: LearningItem["register"];
  tags: string;
  focus_terms: string;
  frequency_band: LearningItem["frequencyBand"];
  currency: LearningItem["currency"];
  persona_fit: number;
  relevance_checked_at: string | null;
  practice_enabled: number;
  embedding?: Buffer | null;
  created_at: string;
  updated_at: string;
};

export type ReviewBatchRow = {
  public_id: string;
  language_code: LanguageCode;
  kind: ReviewBatchKind;
  title: string;
  source_text: string;
  candidates: string;
  status: ReviewBatch["status"];
  source_thread_public_id: string | null;
  destination_topic_title: string | null;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
};

export type ReviewStateRow = {
  due_at: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  repetitions: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export type DueItemRow = ItemRow & {
  review_due_at: string | null;
  review_stability: number | null;
  review_difficulty: number | null;
  review_elapsed_days: number | null;
  review_scheduled_days: number | null;
  review_learning_steps: number | null;
  review_repetitions: number | null;
  review_lapses: number | null;
  review_state: number | null;
  review_last_review: string | null;
  recall_count: number | null;
  listen_count: number | null;
};

export const parseArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const mapItem = (row: ItemRow): LearningItem => ({
  id: row.id,
  publicId: row.public_id,
  language: row.language_code,
  kind: row.kind,
  cue: row.cue,
  target: row.target,
  acceptedAnswers: parseArray(row.accepted_answers),
  note: row.note,
  source: row.source,
  status: row.status,
  preference: row.preference,
  naturalness: row.naturalness,
  commonness: row.commonness,
  register: row.register,
  tags: parseArray(row.tags),
  focusTerms: parseArray(row.focus_terms),
  frequencyBand: row.frequency_band,
  currency: row.currency,
  personaFit: row.persona_fit,
  relevanceCheckedAt: row.relevance_checked_at,
  practiceEnabled: Boolean(row.practice_enabled),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  progress: {
    stage: row.practice_enabled ? "new" : "learned",
    recalls: 0,
    listens: 0,
  },
});

export const mapItemProgress = (row: DueItemRow, now = new Date()): LearningItem["progress"] => {
  const recalls = row.recall_count || 0;
  const listens = row.listen_count || 0;
  const stage = !row.practice_enabled ? "learned"
    : recalls === 0 ? "new"
      : row.review_state === 1 || row.review_state === 3 ? "learning"
        : row.review_due_at && new Date(row.review_due_at) <= now ? "due"
          : "strong";
  return { stage, recalls, listens };
};

export const mapItemWithProgress = (row: DueItemRow, now = new Date()): LearningItem => ({
  ...mapItem(row),
  progress: mapItemProgress(row, now),
});

export const mapReviewBatch = (row: ReviewBatchRow): ReviewBatch => ({
  publicId: row.public_id,
  language: row.language_code,
  kind: row.kind,
  title: row.title,
  sourceText: row.source_text,
  candidates: JSON.parse(row.candidates) as ReviewCandidate[],
  status: row.status,
  sourceThreadPublicId: row.source_thread_public_id,
  destinationTopicTitle: row.destination_topic_title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  committedAt: row.committed_at,
});

export const mapReviewState = (row: ReviewStateRow | undefined): StoredReviewState | undefined =>
  row ? {
    dueAt: row.due_at,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    repetitions: row.repetitions,
    lapses: row.lapses,
    state: row.state,
    lastReview: row.last_review,
  } : undefined;

export const mapJoinedReviewState = (row: DueItemRow): StoredReviewState | undefined =>
  row.review_due_at === null ? undefined : {
    dueAt: row.review_due_at,
    stability: row.review_stability || 0,
    difficulty: row.review_difficulty || 0,
    elapsedDays: row.review_elapsed_days || 0,
    scheduledDays: row.review_scheduled_days || 0,
    learningSteps: row.review_learning_steps || 0,
    repetitions: row.review_repetitions || 0,
    lapses: row.review_lapses || 0,
    state: row.review_state || 0,
    lastReview: row.review_last_review,
  };

export const vectorToBuffer = (vector: number[]) => {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
};

export const cosineSimilarity = (left: number[], right: Buffer) => {
  if (right.byteLength !== left.length * 4) return 0;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    const rightValue = right.readFloatLE(index * 4);
    dot += left[index] * rightValue;
    leftLength += left[index] ** 2;
    rightLength += rightValue ** 2;
  }
  if (!leftLength || !rightLength) return 0;
  return dot / Math.sqrt(leftLength * rightLength);
};

export const makeFtsQuery = (query: string) =>
  (query.match(/[\p{L}\p{N}]+/gu) || [])
    .slice(0, 10)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" OR ");

export const makeThreadTitle = (message: string) => {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const source = lines.length >= 5 ? lines[0] : lines.join(" ");
  const clean = source.replace(/^[-*\d.)\s]+/, "").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  const words = clean.split(" ").slice(0, 8).join(" ");
  const title = words.length > 52 ? `${words.slice(0, 49).trimEnd()}…` : words;
  return clean.length > title.length && !title.endsWith("…") ? `${title}…` : title;
};

export const logChange = (
  db: RehearsalDatabase,
  actor: "user" | "llm" | "system",
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown,
) => {
  db.prepare(
    `INSERT INTO change_events(actor, action, target_type, target_id, before_state, after_state)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    actor,
    action,
    targetType,
    targetId,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
  );
};
