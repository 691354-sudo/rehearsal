import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type {
  LanguageCode,
  LearningItem,
  ReviewBatch,
  ReviewBatchKind,
  ReviewCandidate,
} from "../../types.js";
import type { ItemsRepository } from "./items.js";
import type { LibraryRepository } from "./library.js";
import { logChange, mapReviewBatch, type ReviewBatchRow } from "./shared.js";
import { normalizeNfc } from "../../../contracts/text.js";

const normalizeCandidate = (candidate: ReviewCandidate): ReviewCandidate => ({
  ...candidate,
  target: normalizeNfc(candidate.target.trim()),
  focusTerms: candidate.focusTerms.map((term) => normalizeNfc(term.trim())),
});

export class ReviewsRepository {
  constructor(
    private readonly db: RehearsalDatabase,
    private readonly items: ItemsRepository,
    private readonly library: LibraryRepository,
  ) {}

  create(input: {
    publicId?: string;
    language: LanguageCode;
    kind: ReviewBatchKind;
    title: string;
    sourceText?: string;
    candidates: ReviewCandidate[];
    sourceThreadPublicId?: string;
    destinationTopicTitle?: string;
  }) {
    const publicId = input.publicId || randomUUID();
    const existing = input.publicId ? this.get(publicId) : null;
    if (existing) return existing;
    this.db.prepare(
      `INSERT INTO review_batches(
         public_id, language_code, kind, title, source_text, candidates, source_thread_public_id,
         destination_topic_title
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      publicId,
      input.language,
      input.kind,
      input.title.trim(),
      input.sourceText || "",
      JSON.stringify(input.candidates.map(normalizeCandidate)),
      input.sourceThreadPublicId || null,
      input.destinationTopicTitle?.trim() || null,
    );
    const batch = this.get(publicId)!;
    logChange(this.db, "llm", "create", "review_batch", publicId, null, {
      kind: batch.kind,
      candidates: batch.candidates.length,
    });
    return batch;
  }

  get(publicId: string) {
    const row = this.db.prepare(
      "SELECT * FROM review_batches WHERE public_id = ?",
    ).get(publicId) as ReviewBatchRow | undefined;
    return row ? mapReviewBatch(row) : null;
  }

  replaceCandidate(batchPublicId: string, candidateId: string, candidate: ReviewCandidate) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    const candidates = batch.candidates.map((current) => current.id === candidateId
      ? normalizeCandidate(candidate) : current);
    if (!batch.candidates.some((current) => current.id === candidateId)) return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates.map(normalizeCandidate)), batchPublicId);
    return this.get(batchPublicId);
  }

  replaceCandidates(batchPublicId: string, candidates: ReviewCandidate[], feedback: string) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates.map(normalizeCandidate)), batchPublicId);
    const updated = this.get(batchPublicId)!;
    logChange(this.db, "user", "revise", "review_batch", batchPublicId, batch, {
      ...updated,
      feedback: feedback.trim(),
    });
    return updated;
  }

  replaceGeneratedCandidates(batchPublicId: string, candidates: ReviewCandidate[]) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates.map(normalizeCandidate)), batchPublicId);
    const updated = this.get(batchPublicId)!;
    logChange(this.db, "llm", "revise", "review_batch", batchPublicId,
      { kind: batch.kind, candidates: batch.candidates.length },
      { kind: updated.kind, candidates: updated.candidates.length });
    return updated;
  }

  private selectedCandidates(
    batch: ReviewBatch,
    selected: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
  ) {
    const available = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
    const candidates = selected.map((edited) => {
      const original = available.get(edited.id);
      if (!original) throw new Error("UNKNOWN_REVIEW_CANDIDATE");
      return {
        ...original,
        target: normalizeNfc(edited.target.trim()),
        cue: edited.cue.trim(),
        note: edited.note.trim(),
        category: edited.category.trim(),
      };
    });
    if (candidates.some((candidate) => !candidate.target || !candidate.cue)) {
      throw new Error("EMPTY_REVIEW_CANDIDATE");
    }
    return candidates;
  }

  private saveCandidate(batch: ReviewBatch, candidate: ReviewCandidate) {
    const topicTitle = (batch.destinationTopicTitle || candidate.category).trim();
    if (!topicTitle) throw new Error("TOPIC_REQUIRED");
    const topic = this.library.ensureIsland(batch.language, topicTitle,
      batch.destinationTopicTitle ? "user" : "llm");
    const item = this.items.save({
      language: batch.language,
      kind: batch.kind === "text_import"
        ? "story_line"
        : batch.kind === "chat_review" ? "correction" : "phrase",
      cue: candidate.cue,
      target: candidate.target,
      note: candidate.note,
      source: batch.title,
      tags: [...new Set([candidate.pattern, ...candidate.focusTerms].filter(Boolean))] as string[],
      focusTerms: candidate.focusTerms,
      naturalness: candidate.naturalness,
      commonness: candidate.commonness,
      frequencyBand: candidate.frequencyBand,
      currency: candidate.currency,
      personaFit: candidate.personaFit,
      relevanceCheckedAt: candidate.currency === "uncertain" ? null : new Date().toISOString(),
      register: "casual",
    }, "user");
    this.library.addIslandItem(topic.publicId, item.publicId);
    return item;
  }

  resolveRevision(
    batchPublicId: string,
    accepted: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
    revisedCandidates: ReviewCandidate[],
  ) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    const acceptedCandidates = this.selectedCandidates(batch, accepted);
    const acceptedIds = new Set(acceptedCandidates.map((candidate) => candidate.id));
    if (revisedCandidates.some((candidate) => acceptedIds.has(candidate.id))) {
      throw new Error("DUPLICATE_REVIEW_RESOLUTION");
    }
    const committedItems: LearningItem[] = [];
    const transaction = this.db.transaction(() => {
      for (const candidate of acceptedCandidates) committedItems.push(this.saveCandidate(batch, candidate));
      if (revisedCandidates.length) {
        this.db.prepare(
          "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
        ).run(JSON.stringify(revisedCandidates), batchPublicId);
      } else {
        this.db.prepare(
          `UPDATE review_batches SET candidates = '[]', status = 'committed', committed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
        ).run(batchPublicId);
        if (batch.kind === "capture") {
          this.db.prepare(
            `UPDATE capture_notes SET status = 'processed', audio = NULL,
             processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE review_batch_id = (SELECT id FROM review_batches WHERE public_id = ?)`,
          ).run(batchPublicId);
        }
      }
    });
    transaction();
    const updated = this.get(batchPublicId)!;
    logChange(this.db, "user", "revise", "review_batch", batchPublicId, batch, {
      accepted: committedItems.length,
      remaining: revisedCandidates.length,
    });
    return { batch: updated, items: committedItems };
  }

  resolveCaptureRevision(
    batchPublicId: string,
    accepted: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
    revisedCandidates: ReviewCandidate[],
  ) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.kind !== "capture") return null;
    return this.resolveRevision(batchPublicId, accepted, revisedCandidates);
  }

  resetCapture(batchPublicId: string) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.kind !== "capture" || batch.status !== "draft") return 0;
    const linked = this.db.prepare(
      `SELECT COUNT(*) AS count FROM capture_notes
       WHERE review_batch_id = (SELECT id FROM review_batches WHERE public_id = ?) AND status = 'batched'`,
    ).get(batchPublicId) as { count: number };
    if (!linked.count) return 0;
    const transaction = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE capture_notes SET status = 'ready', review_batch_id = NULL, processed_at = NULL,
         updated_at = CURRENT_TIMESTAMP
         WHERE review_batch_id = (SELECT id FROM review_batches WHERE public_id = ?) AND status = 'batched'`,
      ).run(batchPublicId);
      this.db.prepare("DELETE FROM review_batches WHERE public_id = ?").run(batchPublicId);
      logChange(this.db, "user", "reset", "review_batch", batchPublicId, batch, null);
    });
    transaction();
    return linked.count;
  }

  commit(
    batchPublicId: string,
    selected: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
  ) {
    const batch = this.get(batchPublicId);
    if (!batch) return null;
    if (batch.status === "committed") return { batch, items: [] as LearningItem[] };
    const selectedCandidates = this.selectedCandidates(batch, selected);

    const committedItems: LearningItem[] = [];
    const transaction = this.db.transaction(() => {
      for (const candidate of selectedCandidates) {
        committedItems.push(this.saveCandidate(batch, candidate));
      }
      this.db.prepare(
        `UPDATE review_batches SET status = 'committed', committed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
      ).run(batchPublicId);
      if (batch.kind === "capture") {
        this.db.prepare(
          `UPDATE capture_notes SET status = 'processed', audio = NULL,
           processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE review_batch_id = (SELECT id FROM review_batches WHERE public_id = ?)`,
        ).run(batchPublicId);
      }
    });
    transaction();
    return { batch: this.get(batchPublicId)!, items: committedItems };
  }
}
