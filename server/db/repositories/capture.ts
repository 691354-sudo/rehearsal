import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { CaptureNote, LanguageCode, ReviewBatchKind } from "../../types.js";
import { logChange, mapReviewBatch, type ReviewBatchRow } from "./shared.js";

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

const captureSelect = `SELECT n.public_id, n.language_code, n.transcript, n.audio_mime, n.status,
  n.error, b.public_id AS review_batch_public_id, n.created_at, n.updated_at, n.processed_at
  FROM capture_notes n LEFT JOIN review_batches b ON b.id = n.review_batch_id`;

export class CaptureRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  createText(input: { language: LanguageCode; transcript: string }) {
    const publicId = randomUUID();
    this.db.prepare(
      `INSERT INTO capture_notes(public_id, language_code, transcript, status)
       VALUES (?, ?, ?, 'ready')`,
    ).run(publicId, input.language, input.transcript.trim());
    const note = this.get(publicId)!;
    logChange(this.db, "user", "create", "capture_note", publicId, null, note);
    return note;
  }

  create(input: { publicId?: string; language: LanguageCode; audio: Buffer; audioMime: string }) {
    const publicId = input.publicId || randomUUID();
    this.db.prepare(
      `INSERT INTO capture_notes(public_id, language_code, audio, audio_mime, status)
       VALUES (?, ?, ?, ?, 'transcribing')`,
    ).run(publicId, input.language, input.audio, input.audioMime);
    const note = this.get(publicId)!;
    logChange(this.db, "user", "create", "capture_note", publicId, null, {
      language: input.language,
      audioMime: input.audioMime,
      audioBytes: input.audio.byteLength,
    });
    return note;
  }

  get(publicId: string) {
    const row = this.db.prepare(`${captureSelect} WHERE n.public_id = ?`)
      .get(publicId) as CaptureNoteRow | undefined;
    return row ? mapCaptureNote(row) : null;
  }

  getAudio(publicId: string) {
    return this.db.prepare("SELECT audio, audio_mime FROM capture_notes WHERE public_id = ?")
      .get(publicId) as { audio: Buffer | null; audio_mime: string } | undefined;
  }

  list(language: LanguageCode, includeProcessed = false) {
    const rows = this.db.prepare(
      `${captureSelect} WHERE n.language_code = ? ${includeProcessed ? "" : "AND n.status != 'processed'"}
       ORDER BY n.created_at DESC, n.id DESC`,
    ).all(language) as CaptureNoteRow[];
    return rows.map(mapCaptureNote);
  }

  completeTranscription(publicId: string, transcript: string) {
    const previous = this.get(publicId);
    if (!previous) return null;
    this.db.prepare(
      `UPDATE capture_notes SET transcript = ?, audio = NULL, status = 'ready', error = '',
       updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`,
    ).run(transcript.trim(), publicId);
    const updated = this.get(publicId)!;
    logChange(this.db, "system", "transcribe", "capture_note", publicId, previous, updated);
    return updated;
  }

  failTranscription(publicId: string, error: string) {
    const previous = this.get(publicId);
    if (!previous) return null;
    this.db.prepare(
      `UPDATE capture_notes SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(error.slice(0, 500), publicId);
    const updated = this.get(publicId)!;
    logChange(this.db, "system", "transcription_failed", "capture_note", publicId, previous, updated);
    return updated;
  }

  markTranscribing(publicId: string) {
    const previous = this.get(publicId);
    if (!previous || previous.status !== "failed" || !this.getAudio(publicId)?.audio?.byteLength) return null;
    this.db.prepare(
      `UPDATE capture_notes SET status = 'transcribing', error = '', updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(publicId);
    return this.get(publicId);
  }

  updateTranscript(publicId: string, transcript: string) {
    const previous = this.get(publicId);
    if (!previous || previous.status !== "ready") return null;
    this.db.prepare(
      "UPDATE capture_notes SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(transcript.trim(), publicId);
    const updated = this.get(publicId)!;
    logChange(this.db, "user", "update", "capture_note", publicId, previous, updated);
    return updated;
  }

  delete(publicId: string) {
    const previous = this.get(publicId);
    if (!previous || previous.status === "batched") return false;
    this.db.prepare("DELETE FROM capture_notes WHERE public_id = ?").run(publicId);
    logChange(this.db, "user", "delete", "capture_note", publicId, previous, null);
    return true;
  }

  selectReady(language: LanguageCode, maxCharacters = 50_000) {
    const rows = this.db.prepare(
      `${captureSelect} WHERE n.language_code = ? AND n.status = 'ready' ORDER BY n.id ASC`,
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

  getActiveBatch(language: LanguageCode) {
    const row = this.db.prepare(
      `SELECT DISTINCT b.* FROM capture_notes n JOIN review_batches b ON b.id = n.review_batch_id
       WHERE n.language_code = ? AND n.status = 'batched' AND b.status = 'draft'
       ORDER BY b.updated_at DESC LIMIT 1`,
    ).get(language) as ReviewBatchRow | undefined;
    return row ? mapReviewBatch(row) : null;
  }

  attachToBatch(notePublicIds: string[], batchPublicId: string) {
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
}
