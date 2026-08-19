import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "./database.js";
import type {
  CaptureNote,
  Island,
  IslandSummary,
  LanguageCode,
  LearningItem,
  LearningItemInput,
  ReviewBatch,
  ReviewBatchKind,
  ReviewCandidate,
  SaturationSettings,
  SaturationSnapshotItem,
  SaturationTrack,
  SearchResult,
} from "../types.js";
import {
  cardFromStoredState,
  defaultSchedulerSettings,
  normalizeSchedulerSettings,
  previewReview,
  scheduleReview,
  storedStateFromCard,
  type ReviewRating,
  type SchedulerSettings,
  type StoredReviewState,
} from "../services/scheduler.js";

type ItemRow = {
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

type ReviewBatchRow = {
  public_id: string;
  language_code: LanguageCode;
  kind: ReviewBatchKind;
  title: string;
  source_text: string;
  candidates: string;
  status: ReviewBatch["status"];
  source_thread_public_id: string | null;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
};

type CaptureNoteRow = {
  public_id: string;
  language_code: LanguageCode;
  transcript: string;
  audio_mime: string;
  status: CaptureNote["status"];
  error: string;
  review_batch_public_id: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

type SaturationTrackRow = {
  public_id: string;
  config_hash: string;
  language_code: LanguageCode;
  topic_key: string;
  topic_title: string;
  snapshot: string;
  settings: string;
  status: SaturationTrack["status"];
  cache_key: string;
  duration_seconds: number | null;
  error: string;
  created_at: string;
  updated_at: string;
};

type IslandRow = {
  public_id: string;
  language_code: LanguageCode;
  title: string;
  description: string;
  item_count: number;
  created_at: string;
  updated_at: string;
};

type ReviewStateRow = {
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

type DueItemRow = ItemRow & {
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
};

const parseArray = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const mapItem = (row: ItemRow): LearningItem => ({
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
});

const mapReviewBatch = (row: ReviewBatchRow): ReviewBatch => ({
  publicId: row.public_id,
  language: row.language_code,
  kind: row.kind,
  title: row.title,
  sourceText: row.source_text,
  candidates: JSON.parse(row.candidates) as ReviewCandidate[],
  status: row.status,
  sourceThreadPublicId: row.source_thread_public_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  committedAt: row.committed_at,
});

const mapCaptureNote = (row: CaptureNoteRow): CaptureNote => ({
  publicId: row.public_id,
  language: row.language_code,
  transcript: row.transcript,
  audioMime: row.audio_mime,
  status: row.status,
  error: row.error,
  reviewBatchPublicId: row.review_batch_public_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  processedAt: row.processed_at,
});

const mapSaturationTrack = (row: SaturationTrackRow): SaturationTrack => ({
  publicId: row.public_id,
  configHash: row.config_hash,
  language: row.language_code,
  islandId: row.topic_key,
  topicTitle: row.topic_title,
  snapshot: JSON.parse(row.snapshot) as SaturationSnapshotItem[],
  settings: JSON.parse(row.settings) as SaturationSettings,
  status: row.status,
  cacheKey: row.cache_key,
  durationSeconds: row.duration_seconds,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeTopicKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const mapIslandSummary = (row: IslandRow): IslandSummary => ({
  publicId: row.public_id,
  language: row.language_code,
  title: row.title,
  description: row.description,
  itemCount: row.item_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapReviewState = (row: ReviewStateRow | undefined): StoredReviewState | undefined =>
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

const mapJoinedReviewState = (row: DueItemRow): StoredReviewState | undefined =>
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

const vectorToBuffer = (vector: number[]) => {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  vector.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
};

const cosineSimilarity = (left: number[], right: Buffer) => {
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

const makeFtsQuery = (query: string) =>
  (query.match(/[\p{L}\p{N}]+/gu) || [])
    .slice(0, 10)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" OR ");

const makeThreadTitle = (message: string) => {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const source = lines.length >= 5 ? lines[0] : lines.join(" ");
  const clean = source.replace(/^[-*\d.)\s]+/, "").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  const words = clean.split(" ").slice(0, 8).join(" ");
  const title = words.length > 52 ? `${words.slice(0, 49).trimEnd()}…` : words;
  return clean.length > title.length && !title.endsWith("…") ? `${title}…` : title;
};

export class RehearsalRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  getSchedulerSettings() {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'scheduler'").get() as
      | { value: string }
      | undefined;
    if (!row) return defaultSchedulerSettings;
    try {
      return normalizeSchedulerSettings(JSON.parse(row.value));
    } catch {
      return defaultSchedulerSettings;
    }
  }

  updateSchedulerSettings(input: SchedulerSettings) {
    const previous = this.getSchedulerSettings();
    const settings = normalizeSchedulerSettings(input);
    this.db.prepare(
      `INSERT INTO app_settings(key, value) VALUES ('scheduler', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    ).run(JSON.stringify(settings));
    this.logChange("user", "update", "app_settings", "scheduler", previous, settings);
    return settings;
  }

  listItems(language: LanguageCode, limit = 100) {
    const rows = this.db
      .prepare(
        `SELECT * FROM items
         WHERE language_code = ?
         ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
                  updated_at DESC
         LIMIT ?`,
      )
      .all(language, limit) as ItemRow[];
    return rows.map(mapItem);
  }

  getItem(publicId: string) {
    const row = this.db.prepare("SELECT * FROM items WHERE public_id = ?").get(publicId) as
      | ItemRow
      | undefined;
    return row ? mapItem(row) : null;
  }

  saveItem(input: LearningItemInput, actor: "user" | "llm" | "system" = "user") {
    const publicId = input.publicId || randomUUID();
    const existing = this.getItem(publicId);
    this.db
      .prepare(
        `INSERT INTO items(
           public_id, language_code, kind, cue, target, accepted_answers, note,
           source, status, preference, naturalness, commonness, register, tags,
           focus_terms, frequency_band, currency, persona_fit, relevance_checked_at, practice_enabled
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(public_id) DO UPDATE SET
           language_code = excluded.language_code,
           kind = excluded.kind,
           cue = excluded.cue,
           target = excluded.target,
           accepted_answers = excluded.accepted_answers,
           note = excluded.note,
           source = excluded.source,
           status = excluded.status,
           preference = excluded.preference,
           naturalness = excluded.naturalness,
           commonness = excluded.commonness,
           register = excluded.register,
           tags = excluded.tags,
           focus_terms = excluded.focus_terms,
           frequency_band = excluded.frequency_band,
           currency = excluded.currency,
           persona_fit = excluded.persona_fit,
           relevance_checked_at = excluded.relevance_checked_at,
           practice_enabled = excluded.practice_enabled,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(
        publicId,
        input.language,
        input.kind || "phrase",
        input.cue.trim(),
        input.target.trim(),
        JSON.stringify(input.acceptedAnswers || []),
        input.note?.trim() || "",
        input.source?.trim() || "",
        input.status || "new",
        input.preference || "neutral",
        input.naturalness || 5,
        input.commonness || 5,
        input.register || "neutral",
        JSON.stringify(input.tags || []),
        JSON.stringify(input.focusTerms || []),
        input.frequencyBand || "common",
        input.currency || "current",
        input.personaFit || 5,
        input.relevanceCheckedAt || null,
        input.practiceEnabled === false ? 0 : 1,
      );
    const saved = this.getItem(publicId)!;
    this.logChange(actor, existing ? "update" : "create", "item", publicId, existing, saved);
    return saved;
  }

  updateItemPreference(publicId: string, preference: LearningItem["preference"]) {
    const existing = this.getItem(publicId);
    if (!existing) return null;
    this.db
      .prepare("UPDATE items SET preference = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?")
      .run(preference, publicId);
    const updated = this.getItem(publicId)!;
    this.logChange("user", "update", "item", publicId, existing, updated);
    return updated;
  }

  updateItem(publicId: string, input: Partial<Pick<LearningItemInput,
    "target" | "cue" | "note" | "tags" | "preference" | "frequencyBand" | "practiceEnabled"
  >>) {
    const existing = this.getItem(publicId);
    if (!existing) return null;
    const updated = this.saveItem({
      ...existing,
      publicId,
      target: input.target ?? existing.target,
      cue: input.cue ?? existing.cue,
      note: input.note ?? existing.note,
      tags: input.tags ?? existing.tags,
      preference: input.preference ?? existing.preference,
      frequencyBand: input.frequencyBand ?? existing.frequencyBand,
      practiceEnabled: input.practiceEnabled ?? existing.practiceEnabled,
    });
    return updated;
  }

  deleteItem(publicId: string) {
    const existing = this.getItem(publicId);
    if (!existing) return false;
    this.logChange("user", "delete", "item", publicId, existing, null);
    this.db.prepare("DELETE FROM items WHERE public_id = ?").run(publicId);
    return true;
  }

  createCaptureNote(input: { language: LanguageCode; audio: Buffer; audioMime: string }) {
    const publicId = randomUUID();
    this.db.prepare(
      `INSERT INTO capture_notes(public_id, language_code, audio, audio_mime, status)
       VALUES (?, ?, ?, ?, 'transcribing')`,
    ).run(publicId, input.language, input.audio, input.audioMime);
    const note = this.getCaptureNote(publicId)!;
    this.logChange("user", "create", "capture_note", publicId, null, {
      language: input.language,
      audioMime: input.audioMime,
      audioBytes: input.audio.byteLength,
    });
    return note;
  }

  getCaptureNote(publicId: string) {
    const row = this.db.prepare(
      `SELECT n.public_id, n.language_code, n.transcript, n.audio_mime, n.status,
              n.error, b.public_id AS review_batch_public_id, n.created_at,
              n.updated_at, n.processed_at
       FROM capture_notes n
       LEFT JOIN review_batches b ON b.id = n.review_batch_id
       WHERE n.public_id = ?`,
    ).get(publicId) as CaptureNoteRow | undefined;
    return row ? mapCaptureNote(row) : null;
  }

  getCaptureAudio(publicId: string) {
    return this.db.prepare(
      "SELECT audio, audio_mime FROM capture_notes WHERE public_id = ?",
    ).get(publicId) as { audio: Buffer | null; audio_mime: string } | undefined;
  }

  listCaptureNotes(language: LanguageCode, includeProcessed = false) {
    const rows = this.db.prepare(
      `SELECT n.public_id, n.language_code, n.transcript, n.audio_mime, n.status,
              n.error, b.public_id AS review_batch_public_id, n.created_at,
              n.updated_at, n.processed_at
       FROM capture_notes n
       LEFT JOIN review_batches b ON b.id = n.review_batch_id
       WHERE n.language_code = ? ${includeProcessed ? "" : "AND n.status != 'processed'"}
       ORDER BY n.created_at DESC, n.id DESC`,
    ).all(language) as CaptureNoteRow[];
    return rows.map(mapCaptureNote);
  }

  completeCaptureTranscription(publicId: string, transcript: string) {
    const previous = this.getCaptureNote(publicId);
    if (!previous) return null;
    this.db.prepare(
      `UPDATE capture_notes
       SET transcript = ?, audio = NULL, status = 'ready', error = '', updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(transcript.trim(), publicId);
    const updated = this.getCaptureNote(publicId)!;
    this.logChange("system", "transcribe", "capture_note", publicId, previous, updated);
    return updated;
  }

  failCaptureTranscription(publicId: string, error: string) {
    const previous = this.getCaptureNote(publicId);
    if (!previous) return null;
    this.db.prepare(
      `UPDATE capture_notes
       SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(error.slice(0, 500), publicId);
    const updated = this.getCaptureNote(publicId)!;
    this.logChange("system", "transcription_failed", "capture_note", publicId, previous, updated);
    return updated;
  }

  markCaptureTranscribing(publicId: string) {
    const previous = this.getCaptureNote(publicId);
    if (!previous || previous.status !== "failed") return null;
    const audio = this.getCaptureAudio(publicId)?.audio;
    if (!audio?.byteLength) return null;
    this.db.prepare(
      `UPDATE capture_notes SET status = 'transcribing', error = '', updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(publicId);
    return this.getCaptureNote(publicId);
  }

  updateCaptureTranscript(publicId: string, transcript: string) {
    const previous = this.getCaptureNote(publicId);
    if (!previous || previous.status !== "ready") return null;
    this.db.prepare(
      "UPDATE capture_notes SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(transcript.trim(), publicId);
    const updated = this.getCaptureNote(publicId)!;
    this.logChange("user", "update", "capture_note", publicId, previous, updated);
    return updated;
  }

  deleteCaptureNote(publicId: string) {
    const previous = this.getCaptureNote(publicId);
    if (!previous || previous.status === "batched") return false;
    this.db.prepare("DELETE FROM capture_notes WHERE public_id = ?").run(publicId);
    this.logChange("user", "delete", "capture_note", publicId, previous, null);
    return true;
  }

  selectReadyCaptureNotes(language: LanguageCode, maxCharacters = 50_000) {
    const rows = this.db.prepare(
      `SELECT n.public_id, n.language_code, n.transcript, n.audio_mime, n.status,
              n.error, b.public_id AS review_batch_public_id, n.created_at,
              n.updated_at, n.processed_at
       FROM capture_notes n
       LEFT JOIN review_batches b ON b.id = n.review_batch_id
       WHERE n.language_code = ? AND n.status = 'ready'
       ORDER BY n.id ASC`,
    ).all(language) as CaptureNoteRow[];
    const notes = rows.map(mapCaptureNote);
    const selected: CaptureNote[] = [];
    let length = 0;
    for (const note of notes) {
      const addition = note.transcript.length + (selected.length ? 2 : 0);
      if (selected.length && length + addition > maxCharacters) break;
      if (!selected.length && addition > maxCharacters) continue;
      selected.push(note);
      length += addition;
    }
    return { notes: selected, remaining: Math.max(0, notes.length - selected.length) };
  }

  getActiveCaptureBatch(language: LanguageCode) {
    const row = this.db.prepare(
      `SELECT DISTINCT b.*
       FROM capture_notes n
       JOIN review_batches b ON b.id = n.review_batch_id
       WHERE n.language_code = ? AND n.status = 'batched' AND b.status = 'draft'
       ORDER BY b.updated_at DESC LIMIT 1`,
    ).get(language) as ReviewBatchRow | undefined;
    return row ? mapReviewBatch(row) : null;
  }

  attachCaptureNotesToBatch(notePublicIds: string[], batchPublicId: string) {
    if (!notePublicIds.length) return false;
    const placeholders = notePublicIds.map(() => "?").join(", ");
    const transaction = this.db.transaction(() => {
      const batch = this.db.prepare(
        "SELECT id, language_code, kind FROM review_batches WHERE public_id = ? AND status = 'draft'",
      ).get(batchPublicId) as { id: number; language_code: LanguageCode; kind: ReviewBatchKind } | undefined;
      if (!batch || batch.kind !== "capture") throw new Error("CAPTURE_BATCH_NOT_FOUND");
      const rows = this.db.prepare(
        `SELECT public_id, language_code, status FROM capture_notes WHERE public_id IN (${placeholders})`,
      ).all(...notePublicIds) as Array<{ public_id: string; language_code: LanguageCode; status: string }>;
      if (rows.length !== notePublicIds.length || rows.some((row) =>
        row.language_code !== batch.language_code || row.status !== "ready"
      )) throw new Error("CAPTURE_NOTES_CHANGED");
      this.db.prepare(
        `UPDATE capture_notes SET status = 'batched', review_batch_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE public_id IN (${placeholders})`,
      ).run(batch.id, ...notePublicIds);
    });
    transaction();
    return true;
  }

  createReviewBatch(input: {
    language: LanguageCode;
    kind: ReviewBatchKind;
    title: string;
    sourceText?: string;
    candidates: ReviewCandidate[];
    sourceThreadPublicId?: string;
  }) {
    const publicId = randomUUID();
    this.db.prepare(
      `INSERT INTO review_batches(
         public_id, language_code, kind, title, source_text, candidates, source_thread_public_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      publicId,
      input.language,
      input.kind,
      input.title.trim(),
      input.sourceText || "",
      JSON.stringify(input.candidates),
      input.sourceThreadPublicId || null,
    );
    const batch = this.getReviewBatch(publicId)!;
    this.logChange("llm", "create", "review_batch", publicId, null, {
      kind: batch.kind,
      candidates: batch.candidates.length,
    });
    return batch;
  }

  getReviewBatch(publicId: string) {
    const row = this.db.prepare("SELECT * FROM review_batches WHERE public_id = ?").get(publicId) as
      | ReviewBatchRow
      | undefined;
    return row ? mapReviewBatch(row) : null;
  }

  replaceReviewCandidate(batchPublicId: string, candidateId: string, candidate: ReviewCandidate) {
    const batch = this.getReviewBatch(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    const candidates = batch.candidates.map((current) => current.id === candidateId ? candidate : current);
    if (!batch.candidates.some((current) => current.id === candidateId)) return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates), batchPublicId);
    return this.getReviewBatch(batchPublicId);
  }

  replaceReviewCandidates(batchPublicId: string, candidates: ReviewCandidate[], feedback: string) {
    const batch = this.getReviewBatch(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates), batchPublicId);
    const updated = this.getReviewBatch(batchPublicId)!;
    this.logChange("user", "revise", "review_batch", batchPublicId, batch, {
      ...updated,
      feedback: feedback.trim(),
    });
    return updated;
  }

  commitReviewBatch(
    batchPublicId: string,
    selected: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
  ) {
    const batch = this.getReviewBatch(batchPublicId);
    if (!batch) return null;
    if (batch.status === "committed") return { batch, items: [] as LearningItem[] };
    const available = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
    const selectedCandidates = selected.map((edited) => {
      const original = available.get(edited.id);
      if (!original) throw new Error("UNKNOWN_REVIEW_CANDIDATE");
      return {
        ...original,
        target: edited.target.trim(),
        cue: edited.cue.trim(),
        note: edited.note.trim(),
        category: edited.category.trim(),
      };
    });
    if (selectedCandidates.some((candidate) => !candidate.target || !candidate.cue)) {
      throw new Error("EMPTY_REVIEW_CANDIDATE");
    }
    const items: LearningItem[] = [];
    const transaction = this.db.transaction(() => {
      for (const candidate of selectedCandidates) {
        const item = this.saveItem({
          language: batch.language,
          kind: batch.kind === "text_import" ? "story_line" : batch.kind === "chat_review" ? "correction" : "phrase",
          cue: candidate.cue,
          target: candidate.target,
          note: candidate.note,
          source: batch.title,
          tags: candidate.category ? [candidate.category] : [],
          focusTerms: candidate.focusTerms,
          naturalness: candidate.naturalness,
          commonness: candidate.commonness,
          frequencyBand: candidate.frequencyBand,
          currency: candidate.currency,
          personaFit: candidate.personaFit,
          relevanceCheckedAt: candidate.currency === "uncertain" ? null : new Date().toISOString(),
          register: "casual",
        }, "user");
        items.push(item);
        if (batch.kind === "capture" && candidate.category) {
          const topic = this.ensureIsland(batch.language, candidate.category, "llm");
          this.addIslandItem(topic.publicId, item.publicId);
        }
      }
      this.db.prepare(
        `UPDATE review_batches SET status = 'committed', committed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
      ).run(batchPublicId);
      if (batch.kind === "capture") {
        this.db.prepare(
          `UPDATE capture_notes
           SET status = 'processed', audio = NULL, processed_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE review_batch_id = (SELECT id FROM review_batches WHERE public_id = ?)`,
        ).run(batchPublicId);
      }
    });
    transaction();
    return { batch: this.getReviewBatch(batchPublicId)!, items };
  }

  saveSource(input: {
    publicId?: string;
    language: LanguageCode;
    title: string;
    rawText: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }) {
    const publicId = input.publicId || randomUUID();
    this.db
      .prepare(
        `INSERT INTO sources(public_id, language_code, title, kind, raw_text, metadata)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(public_id) DO UPDATE SET
           language_code = excluded.language_code,
           title = excluded.title,
           kind = excluded.kind,
           raw_text = excluded.raw_text,
           metadata = excluded.metadata`,
      )
      .run(
        publicId,
        input.language,
        input.title.trim(),
        input.kind || "text",
        input.rawText,
        JSON.stringify(input.metadata || {}),
      );
    this.logChange(input.publicId ? "system" : "user", "create", "source", publicId, null, {
      language: input.language,
      title: input.title,
      characters: input.rawText.length,
    });
    return { publicId };
  }

  search(query: string, language: LanguageCode, embedding?: number[], limit = 20): SearchResult[] {
    const keywordScores = new Map<string, number>();
    const itemById = new Map<string, LearningItem>();
    const ftsQuery = makeFtsQuery(query);

    if (ftsQuery) {
      const keywordRows = this.db
        .prepare(
          `SELECT i.*, bm25(items_fts, 4.0, 1.5, 0.8, 0.3) AS keyword_rank
           FROM items_fts
           JOIN items i ON i.id = items_fts.rowid
           WHERE items_fts MATCH ? AND i.language_code = ?
           ORDER BY keyword_rank
           LIMIT 50`,
        )
        .all(ftsQuery, language) as Array<ItemRow & { keyword_rank: number }>;
      keywordRows.forEach((row, index) => {
        const item = mapItem(row);
        itemById.set(item.publicId, item);
        keywordScores.set(item.publicId, Math.max(0.2, 1 - index / 55));
      });
    }

    const semanticScores = new Map<string, number>();
    if (embedding?.length) {
      const semanticRows = this.db
        .prepare(
          `SELECT * FROM items
           WHERE language_code = ? AND embedding IS NOT NULL`,
        )
        .all(language) as ItemRow[];
      semanticRows
        .map((row) => ({ row, score: cosineSimilarity(embedding, row.embedding!) }))
        .filter(({ score }) => score > 0.1)
        .sort((left, right) => right.score - left.score)
        .slice(0, 50)
        .forEach(({ row, score }) => {
          const item = mapItem(row);
          itemById.set(item.publicId, item);
          semanticScores.set(item.publicId, score);
        });
    }

    if (!itemById.size) {
      const like = `%${query.trim().toLocaleLowerCase()}%`;
      const rows = this.db
        .prepare(
          `SELECT * FROM items
           WHERE language_code = ?
             AND (lower(target) LIKE ? OR lower(cue) LIKE ? OR lower(note) LIKE ?)
           ORDER BY naturalness DESC, commonness DESC
           LIMIT ?`,
        )
        .all(language, like, like, like, limit) as ItemRow[];
      rows.forEach((row, index) => {
        const item = mapItem(row);
        itemById.set(item.publicId, item);
        keywordScores.set(item.publicId, Math.max(0.2, 1 - index / (limit + 2)));
      });
    }

    return [...itemById.values()]
      .map((item) => {
        const keyword = keywordScores.get(item.publicId) || 0;
        const semantic = semanticScores.get(item.publicId) || 0;
        const quality = (item.naturalness + item.commonness) / 10;
        const score = (keyword * 0.55 + semantic * 0.4 + quality * 0.05);
        return {
          ...item,
          score: Number(score.toFixed(4)),
          match: keyword && semantic ? "hybrid" : semantic ? "semantic" : "keyword",
        } as SearchResult;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  itemsMissingEmbeddings(limit = 100) {
    return (this.db
      .prepare("SELECT * FROM items WHERE embedding IS NULL ORDER BY id LIMIT ?")
      .all(limit) as ItemRow[]).map(mapItem);
  }

  updateEmbedding(publicId: string, vector: number[], model: string) {
    this.db
      .prepare(
        `UPDATE items SET embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP
         WHERE public_id = ?`,
      )
      .run(vectorToBuffer(vector), model, publicId);
  }

  recordAttempt(input: {
    itemPublicId: string;
    mode: string;
    answer: string;
    score: number;
    verdict: string;
    feedback: Record<string, unknown>;
    rating?: ReviewRating;
    reviewedAt?: Date;
  }) {
    const item = this.db.prepare("SELECT id, preference FROM items WHERE public_id = ?").get(input.itemPublicId) as
      | { id: number; preference: LearningItem["preference"] }
      | undefined;
    if (!item) throw new Error("Item not found");
    const publicId = randomUUID();
    const reviewedAt = input.reviewedAt || new Date();
    const schedulerSettings = this.getSchedulerSettings();
    let schedule = null;
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attempts(public_id, item_id, mode, answer, score, verdict, feedback)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          publicId,
          item.id,
          input.mode,
          input.answer,
          input.score,
          input.verdict,
          JSON.stringify(input.feedback),
        );
      if (input.mode === "recall" && input.rating) {
        const currentRow = this.db
          .prepare("SELECT * FROM review_state WHERE item_id = ?")
          .get(item.id) as ReviewStateRow | undefined;
        const currentCard = cardFromStoredState(mapReviewState(currentRow), reviewedAt);
        const result = scheduleReview(currentCard, input.rating, reviewedAt, item.preference, schedulerSettings);
        const next = storedStateFromCard(result.card);
        this.db
          .prepare(
            `INSERT INTO review_state(
               item_id, due_at, repetitions, lapses, last_score, state, stability,
               difficulty, elapsed_days, scheduled_days, learning_steps, last_review
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(item_id) DO UPDATE SET
               due_at = excluded.due_at,
               repetitions = excluded.repetitions,
               lapses = excluded.lapses,
               last_score = excluded.last_score,
               state = excluded.state,
               stability = excluded.stability,
               difficulty = excluded.difficulty,
               elapsed_days = excluded.elapsed_days,
               scheduled_days = excluded.scheduled_days,
               learning_steps = excluded.learning_steps,
               last_review = excluded.last_review,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(
            item.id,
            next.dueAt,
            next.repetitions,
            next.lapses,
            input.score,
            next.state,
            next.stability,
            next.difficulty,
            next.elapsedDays,
            next.scheduledDays,
            next.learningSteps,
            next.lastReview,
          );
        schedule = previewReview(result.card, result.card.due, item.preference, schedulerSettings);
      }
    });
    transaction();
    return { publicId, schedule };
  }

  countAttemptsSince(language: LanguageCode, since: string, mode = "recall") {
    const result = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM attempts a
         JOIN items i ON i.id = a.item_id
         WHERE i.language_code = ? AND a.mode = ? AND datetime(a.created_at) >= datetime(?)`,
      )
      .get(language, mode, since) as { count: number };
    return result.count;
  }

  countActivitySince(language: LanguageCode, since: string) {
    const rows = this.db.prepare(
      `SELECT a.mode, COUNT(*) AS count FROM attempts a
       JOIN items i ON i.id = a.item_id
       WHERE i.language_code = ? AND datetime(a.created_at) >= datetime(?)
       GROUP BY a.mode`,
    ).all(language, since) as Array<{ mode: string; count: number }>;
    const counts = { recall: 0, shadow: 0, pattern: 0 };
    for (const row of rows) {
      if (row.mode in counts) counts[row.mode as keyof typeof counts] = row.count;
    }
    return counts;
  }

  listDueItems(language: LanguageCode, limit = 12, now = new Date(), newLimit = 10) {
    const schedulerSettings = this.getSchedulerSettings();
    const select = `SELECT i.*,
                r.due_at AS review_due_at,
                r.stability AS review_stability,
                r.difficulty AS review_difficulty,
                r.elapsed_days AS review_elapsed_days,
                r.scheduled_days AS review_scheduled_days,
                r.learning_steps AS review_learning_steps,
                r.repetitions AS review_repetitions,
                r.lapses AS review_lapses,
                r.state AS review_state,
                r.last_review AS review_last_review
         FROM items i LEFT JOIN review_state r ON r.item_id = i.id`;
    const scheduled = this.db.prepare(
      `${select}
       WHERE i.language_code = ? AND i.practice_enabled = 1
         AND r.due_at IS NOT NULL AND datetime(r.due_at) <= datetime(?)
       ORDER BY CASE COALESCE(r.state, 0) WHEN 1 THEN 0 WHEN 3 THEN 0 WHEN 2 THEN 1 ELSE 2 END,
                  CASE i.preference WHEN 'like' THEN 0 WHEN 'neutral' THEN 1 ELSE 2 END,
                  COALESCE(r.due_at, '1970-01-01')
       LIMIT ?`,
    ).all(language, now.toISOString(), limit) as DueItemRow[];
    const remaining = Math.max(0, limit - scheduled.length);
    const freshLimit = Math.min(remaining, Math.max(0, newLimit));
    const fresh = freshLimit ? this.db.prepare(
      `${select}
       WHERE i.language_code = ? AND i.practice_enabled = 1 AND r.due_at IS NULL
       ORDER BY CASE i.preference WHEN 'like' THEN 0 WHEN 'neutral' THEN 1 ELSE 2 END,
                i.commonness DESC, i.persona_fit DESC, i.created_at
       LIMIT ?`,
    ).all(language, freshLimit) as DueItemRow[] : [];
    const rows = [...scheduled, ...fresh];
    return rows.map((row) => ({
      ...mapItem(row),
      schedule: previewReview(
        cardFromStoredState(mapJoinedReviewState(row), now),
        now,
        row.preference,
        schedulerSettings,
      ),
    }));
  }

  getOrCreateThread(publicId: string | undefined, language: LanguageCode) {
    if (publicId) {
      const found = this.db
        .prepare("SELECT id, public_id FROM chat_threads WHERE public_id = ?")
        .get(publicId) as { id: number; public_id: string } | undefined;
      if (found) return { id: found.id, publicId: found.public_id };
    }
    const nextPublicId = randomUUID();
    const result = this.db
      .prepare("INSERT INTO chat_threads(public_id, language_code) VALUES (?, ?)")
      .run(nextPublicId, language);
    return { id: Number(result.lastInsertRowid), publicId: nextPublicId };
  }

  getThread(publicId: string) {
    return this.db.prepare(
      "SELECT id, public_id, language_code, title, created_at, updated_at FROM chat_threads WHERE public_id = ?",
    ).get(publicId) as {
      id: number;
      public_id: string;
      language_code: LanguageCode;
      title: string;
      created_at: string;
      updated_at: string;
    } | undefined;
  }

  ensureThreadTitle(threadId: number, message: string) {
    const row = this.db.prepare("SELECT title FROM chat_threads WHERE id = ?").get(threadId) as
      | { title: string }
      | undefined;
    if (!row || row.title !== "Tutor chat") return row?.title || "New conversation";
    const title = makeThreadTitle(message);
    this.db.prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(title, threadId);
    return title;
  }

  listThreads(language: LanguageCode, limit = 50) {
    const rows = this.db.prepare(
      `SELECT t.id, t.public_id, t.title, t.created_at, t.updated_at,
              COUNT(m.id) AS message_count,
              (SELECT first_message.content FROM chat_messages first_message
               WHERE first_message.thread_id = t.id AND first_message.role = 'user'
               ORDER BY first_message.id LIMIT 1) AS first_message
       FROM chat_threads t
       LEFT JOIN chat_messages m ON m.thread_id = t.id AND m.role IN ('user', 'assistant')
       WHERE t.language_code = ?
       GROUP BY t.id
       HAVING COUNT(m.id) > 0
       ORDER BY datetime(t.updated_at) DESC, t.id DESC
       LIMIT ?`,
    ).all(language, limit) as Array<{
      id: number;
      public_id: string;
      title: string;
      created_at: string;
      updated_at: string;
      message_count: number;
      first_message: string | null;
    }>;

    return rows.map((row) => {
      const title = row.title === "Tutor chat" && row.first_message
        ? this.ensureThreadTitle(row.id, row.first_message)
        : row.title;
      return {
        publicId: row.public_id,
        title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count,
      };
    });
  }

  addMessage(threadId: number, role: "user" | "assistant" | "tool", content: string, metadata = {}) {
    this.db
      .prepare("INSERT INTO chat_messages(thread_id, role, content, metadata) VALUES (?, ?, ?, ?)")
      .run(threadId, role, content, JSON.stringify(metadata));
    this.db.prepare("UPDATE chat_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(threadId);
  }

  getMessages(threadId: number, limit = 30) {
    return (this.db
      .prepare(
        `SELECT role, content FROM (
         SELECT id, role, content FROM chat_messages
           WHERE thread_id = ? AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?
         ) ORDER BY id`,
      )
      .all(threadId, limit) as Array<{ role: "user" | "assistant"; content: string }>);
  }

  createIsland(input: {
    language: LanguageCode;
    title: string;
    description?: string;
    itemPublicIds?: string[];
  }, actor: "user" | "llm" | "system" = "user") {
    if (this.findIslandByTitle(input.language, input.title)) throw new Error("TOPIC_TITLE_EXISTS");
    const publicId = randomUUID();
    const transaction = this.db.transaction(() => {
      const result = this.db
        .prepare(
          "INSERT INTO islands(public_id, language_code, title, description) VALUES (?, ?, ?, ?)",
        )
        .run(publicId, input.language, input.title, input.description || "");
      const islandId = Number(result.lastInsertRowid);
      const add = this.db.prepare(
        `INSERT OR IGNORE INTO island_items(island_id, item_id, position)
         VALUES (?, ?, ?)`,
      );
      (input.itemPublicIds || []).forEach((itemPublicId, index) => {
        const item = this.db.prepare("SELECT id FROM items WHERE public_id = ? AND language_code = ?")
          .get(itemPublicId, input.language) as { id: number } | undefined;
        if (!item) throw new Error("TOPIC_ITEM_NOT_FOUND");
        add.run(islandId, item.id, index);
      });
    });
    transaction();
    this.logChange(actor, "create", "island", publicId, null, input);
    return this.getIsland(publicId)!;
  }

  listIslands(language: LanguageCode) {
    const rows = this.db.prepare(
      `SELECT i.public_id, i.language_code, i.title, i.description, i.created_at, i.updated_at,
              COUNT(ii.item_id) AS item_count
       FROM islands i
       LEFT JOIN island_items ii ON ii.island_id = i.id
       WHERE i.language_code = ?
       GROUP BY i.id
       ORDER BY i.title COLLATE NOCASE, i.id`,
    ).all(language) as IslandRow[];
    return rows.map(mapIslandSummary);
  }

  getIsland(publicId: string): Island | null {
    const row = this.db.prepare(
      `SELECT i.public_id, i.language_code, i.title, i.description, i.created_at, i.updated_at,
              COUNT(ii.item_id) AS item_count
       FROM islands i LEFT JOIN island_items ii ON ii.island_id = i.id
       WHERE i.public_id = ? GROUP BY i.id`,
    ).get(publicId) as IslandRow | undefined;
    if (!row) return null;
    const items = (this.db.prepare(
      `SELECT items.* FROM island_items
       JOIN islands ON islands.id = island_items.island_id
       JOIN items ON items.id = island_items.item_id
       WHERE islands.public_id = ?
       ORDER BY island_items.position, island_items.rowid`,
    ).all(publicId) as ItemRow[]).map(mapItem);
    return { ...mapIslandSummary(row), items };
  }

  findIslandByTitle(language: LanguageCode, title: string) {
    const normalized = normalizeTopicKey(title);
    return this.listIslands(language).find((island) => normalizeTopicKey(island.title) === normalized) || null;
  }

  ensureIsland(language: LanguageCode, title: string, actor: "llm" | "system" = "system") {
    return this.findIslandByTitle(language, title) || this.createIsland({ language, title: title.trim() }, actor);
  }

  addIslandItem(islandPublicId: string, itemPublicId: string) {
    const island = this.db.prepare("SELECT id, language_code FROM islands WHERE public_id = ?")
      .get(islandPublicId) as { id: number; language_code: LanguageCode } | undefined;
    if (!island) throw new Error("TOPIC_NOT_FOUND");
    const item = this.db.prepare("SELECT id FROM items WHERE public_id = ? AND language_code = ?")
      .get(itemPublicId, island.language_code) as { id: number } | undefined;
    if (!item) throw new Error("TOPIC_ITEM_NOT_FOUND");
    const position = (this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM island_items WHERE island_id = ?")
      .get(island.id) as { position: number }).position;
    this.db.prepare("INSERT OR IGNORE INTO island_items(island_id, item_id, position) VALUES (?, ?, ?)")
      .run(island.id, item.id, position);
    this.db.prepare("UPDATE islands SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(island.id);
  }

  updateIsland(publicId: string, input: { title?: string; description?: string; itemPublicIds?: string[] }) {
    const before = this.getIsland(publicId);
    if (!before) return null;
    const nextTitle = input.title?.trim() || before.title;
    const duplicate = this.findIslandByTitle(before.language, nextTitle);
    if (duplicate && duplicate.publicId !== publicId) throw new Error("TOPIC_TITLE_EXISTS");
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE islands SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
      ).run(nextTitle, input.description?.trim() ?? before.description, publicId);
      if (input.itemPublicIds) {
        const islandRow = this.db.prepare("SELECT id FROM islands WHERE public_id = ?").get(publicId) as { id: number };
        const resolved = input.itemPublicIds.map((itemPublicId) => {
          const item = this.db.prepare("SELECT id FROM items WHERE public_id = ? AND language_code = ?")
            .get(itemPublicId, before.language) as { id: number } | undefined;
          if (!item) throw new Error("TOPIC_ITEM_NOT_FOUND");
          return item.id;
        });
        if (new Set(resolved).size !== resolved.length) throw new Error("TOPIC_ITEM_DUPLICATE");
        this.db.prepare("DELETE FROM island_items WHERE island_id = ?").run(islandRow.id);
        const add = this.db.prepare("INSERT INTO island_items(island_id, item_id, position) VALUES (?, ?, ?)");
        resolved.forEach((itemId, position) => add.run(islandRow.id, itemId, position));
      }
    });
    transaction();
    const updated = this.getIsland(publicId)!;
    this.logChange("user", "update", "island", publicId, before, updated);
    return updated;
  }

  deleteIsland(publicId: string) {
    const before = this.getIsland(publicId);
    if (!before) return false;
    this.db.prepare("DELETE FROM islands WHERE public_id = ?").run(publicId);
    this.logChange("user", "delete", "island", publicId, before, null);
    return true;
  }

  backfillTopicsFromTags(language?: LanguageCode) {
    const languages = language ? [language] : ["en", "lv"] as const;
    let created = 0; let attached = 0;
    const transaction = this.db.transaction(() => {
      for (const languageCode of languages) {
        const rows = this.db.prepare(
          "SELECT public_id, tags FROM items WHERE language_code = ? ORDER BY created_at, id",
        ).all(languageCode) as Array<{ public_id: string; tags: string }>;
        for (const row of rows) {
          const title = parseArray(row.tags)[0]?.trim();
          if (!title) continue;
          let island = this.findIslandByTitle(languageCode, title);
          if (!island) { island = this.createIsland({ language: languageCode, title }, "system"); created += 1; }
          const beforeCount = this.getIsland(island.publicId)!.itemCount;
          this.addIslandItem(island.publicId, row.public_id);
          if (this.getIsland(island.publicId)!.itemCount > beforeCount) attached += 1;
        }
      }
    });
    transaction();
    return { created, attached };
  }

  runTopicBackfillMigration() {
    const applied = this.db.prepare("SELECT value FROM app_settings WHERE key = 'topics_backfill_v1'").get() as
      | { value: string }
      | undefined;
    if (applied?.value === "done") return { created: 0, attached: 0, applied: false };
    const result = this.backfillTopicsFromTags();
    this.db.prepare(
      `INSERT INTO app_settings(key, value) VALUES ('topics_backfill_v1', 'done')
       ON CONFLICT(key) DO UPDATE SET value = 'done', updated_at = CURRENT_TIMESTAMP`,
    ).run();
    return { ...result, applied: true };
  }

  listSaturationTopics(language: LanguageCode) {
    const rows = this.db.prepare(
      `SELECT islands.public_id AS island_id, islands.title, COUNT(items.id) AS count
       FROM islands
       JOIN island_items ON island_items.island_id = islands.id
       JOIN items ON items.id = island_items.item_id AND items.practice_enabled = 1
       WHERE islands.language_code = ?
       GROUP BY islands.id HAVING COUNT(items.id) > 0
       ORDER BY islands.title COLLATE NOCASE, islands.id`,
    ).all(language) as Array<{ island_id: string; title: string; count: number }>;
    return rows.map((row) => ({ islandId: row.island_id, title: row.title, count: row.count }));
  }

  getSaturationTopicItems(language: LanguageCode, islandId: string): SaturationSnapshotItem[] {
    const rows = this.db.prepare(
      `SELECT items.public_id, items.target FROM islands
       JOIN island_items ON island_items.island_id = islands.id
       JOIN items ON items.id = island_items.item_id
       WHERE islands.public_id = ? AND islands.language_code = ? AND items.practice_enabled = 1
       ORDER BY island_items.position, island_items.rowid`,
    ).all(islandId, language) as Array<{ public_id: string; target: string }>;
    return rows.map((row) => ({ publicId: row.public_id, target: row.target }));
  }

  getSaturationTrack(publicId: string) {
    const row = this.db.prepare("SELECT * FROM saturation_tracks WHERE public_id = ?")
      .get(publicId) as SaturationTrackRow | undefined;
    return row ? mapSaturationTrack(row) : null;
  }

  getSaturationTrackByHash(configHash: string) {
    const row = this.db.prepare("SELECT * FROM saturation_tracks WHERE config_hash = ?")
      .get(configHash) as SaturationTrackRow | undefined;
    return row ? mapSaturationTrack(row) : null;
  }

  createOrRetrySaturationTrack(input: {
    configHash: string;
    language: LanguageCode;
    islandId: string;
    topicTitle: string;
    snapshot: SaturationSnapshotItem[];
    settings: SaturationSettings;
    cacheKey: string;
  }) {
    const existing = this.getSaturationTrackByHash(input.configHash);
    if (existing) {
      if (existing.status === "failed") {
        this.db.prepare(
          `UPDATE saturation_tracks SET status = 'building', error = '', duration_seconds = NULL,
           snapshot = ?, settings = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
        ).run(JSON.stringify(input.snapshot), JSON.stringify(input.settings), existing.publicId);
        return { track: this.getSaturationTrack(existing.publicId)!, shouldBuild: true };
      }
      return { track: existing, shouldBuild: false };
    }
    const publicId = randomUUID();
    this.db.prepare(
      `INSERT INTO saturation_tracks(
         public_id, config_hash, language_code, topic_key, topic_title, snapshot,
         settings, status, cache_key
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'building', ?)`,
    ).run(
      publicId, input.configHash, input.language, input.islandId, input.topicTitle,
      JSON.stringify(input.snapshot), JSON.stringify(input.settings), input.cacheKey,
    );
    return { track: this.getSaturationTrack(publicId)!, shouldBuild: true };
  }

  completeSaturationTrack(publicId: string, durationSeconds: number) {
    this.db.prepare(
      `UPDATE saturation_tracks SET status = 'ready', duration_seconds = ?, error = '',
       updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
    ).run(durationSeconds, publicId);
    return this.getSaturationTrack(publicId);
  }

  failSaturationTrack(publicId: string, error: string) {
    this.db.prepare(
      `UPDATE saturation_tracks SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(error.slice(0, 2_000), publicId);
    return this.getSaturationTrack(publicId);
  }

  recoverInterruptedSaturationTracks() {
    return this.db.prepare(
      `UPDATE saturation_tracks SET status = 'failed', error = 'BUILD_INTERRUPTED',
       updated_at = CURRENT_TIMESTAMP WHERE status = 'building'`,
    ).run().changes;
  }

  stats() {
    const items = this.db.prepare("SELECT language_code, COUNT(*) AS count FROM items GROUP BY language_code").all();
    const sources = this.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    const attempts = this.db.prepare("SELECT COUNT(*) AS count FROM attempts").get() as { count: number };
    return { items, sources: sources.count, attempts: attempts.count };
  }

  getCachedAudio(cacheKey: string) {
    return this.db
      .prepare("SELECT format, audio FROM audio_cache WHERE cache_key = ?")
      .get(cacheKey) as { format: string; audio: Buffer } | undefined;
  }

  saveCachedAudio(input: {
    cacheKey: string;
    model: string;
    voice: string;
    format: string;
    audio: Buffer;
  }) {
    this.db
      .prepare(
        `INSERT INTO audio_cache(cache_key, model, voice, format, audio)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET audio = excluded.audio, created_at = CURRENT_TIMESTAMP`,
      )
      .run(input.cacheKey, input.model, input.voice, input.format, input.audio);
  }

  private logChange(
    actor: "user" | "llm" | "system",
    action: string,
    targetType: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ) {
    this.db
      .prepare(
        `INSERT INTO change_events(actor, action, target_type, target_id, before_state, after_state)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        actor,
        action,
        targetType,
        targetId,
        before == null ? null : JSON.stringify(before),
        after == null ? null : JSON.stringify(after),
      );
  }
}
