import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type {
  LanguageCode,
  LearningItem,
  ReviewBatchKind,
  ReviewCandidate,
} from "../../types.js";
import type { ItemsRepository } from "./items.js";
import type { LibraryRepository } from "./library.js";
import { logChange, mapReviewBatch, type ReviewBatchRow } from "./shared.js";

export class ReviewsRepository {
  constructor(
    private readonly db: RehearsalDatabase,
    private readonly items: ItemsRepository,
    private readonly library: LibraryRepository,
  ) {}

  create(input: {
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
    const candidates = batch.candidates.map((current) => current.id === candidateId ? candidate : current);
    if (!batch.candidates.some((current) => current.id === candidateId)) return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates), batchPublicId);
    return this.get(batchPublicId);
  }

  replaceCandidates(batchPublicId: string, candidates: ReviewCandidate[], feedback: string) {
    const batch = this.get(batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    this.db.prepare(
      "UPDATE review_batches SET candidates = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(JSON.stringify(candidates), batchPublicId);
    const updated = this.get(batchPublicId)!;
    logChange(this.db, "user", "revise", "review_batch", batchPublicId, batch, {
      ...updated,
      feedback: feedback.trim(),
    });
    return updated;
  }

  commit(
    batchPublicId: string,
    selected: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>,
  ) {
    const batch = this.get(batchPublicId);
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

    const committedItems: LearningItem[] = [];
    const transaction = this.db.transaction(() => {
      for (const candidate of selectedCandidates) {
        const item = this.items.save({
          language: batch.language,
          kind: batch.kind === "text_import"
            ? "story_line"
            : batch.kind === "chat_review" ? "correction" : "phrase",
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
        committedItems.push(item);
        if (batch.kind === "capture" && candidate.category) {
          const topic = this.library.ensureIsland(batch.language, candidate.category, "llm");
          this.library.addIslandItem(topic.publicId, item.publicId);
        }
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
