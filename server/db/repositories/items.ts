import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode, LearningItem, LearningItemInput, SearchResult } from "../../types.js";
import { normalizeNfc } from "../../../contracts/text.js";
import {
  cosineSimilarity,
  logChange,
  makeFtsQuery,
  mapItem,
  vectorToBuffer,
  type ItemRow,
} from "./shared.js";

export class ItemsRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  list(language: LanguageCode, limit = 100) {
    const rows = this.db.prepare(
      `SELECT * FROM items
       WHERE language_code = ?
       ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
                updated_at DESC
       LIMIT ?`,
    ).all(language, limit) as ItemRow[];
    return rows.map(mapItem);
  }

  get(publicId: string) {
    const row = this.db.prepare("SELECT * FROM items WHERE public_id = ?").get(publicId) as ItemRow | undefined;
    return row ? mapItem(row) : null;
  }

  save(input: LearningItemInput, actor: "user" | "llm" | "system" = "user") {
    const publicId = input.publicId || randomUUID();
    const existing = this.get(publicId);
    this.db.prepare(
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
    ).run(
      publicId,
      input.language,
      input.kind || "phrase",
      input.cue.trim(),
      normalizeNfc(input.target.trim()),
      JSON.stringify((input.acceptedAnswers || []).map((answer) => normalizeNfc(answer.trim()))),
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
    const saved = this.get(publicId)!;
    logChange(this.db, actor, existing ? "update" : "create", "item", publicId, existing, saved);
    return saved;
  }

  updatePreference(publicId: string, preference: LearningItem["preference"]) {
    const existing = this.get(publicId);
    if (!existing) return null;
    this.db.prepare(
      "UPDATE items SET preference = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
    ).run(preference, publicId);
    const updated = this.get(publicId)!;
    logChange(this.db, "user", "update", "item", publicId, existing, updated);
    return updated;
  }

  update(publicId: string, input: Partial<Pick<LearningItemInput,
    "target" | "cue" | "note" | "tags" | "focusTerms" | "preference" | "frequencyBand" | "practiceEnabled"
  >>) {
    const existing = this.get(publicId);
    if (!existing) return null;
    return this.save({
      ...existing,
      publicId,
      target: input.target ?? existing.target,
      cue: input.cue ?? existing.cue,
      note: input.note ?? existing.note,
      tags: input.tags ?? existing.tags,
      focusTerms: input.focusTerms ?? existing.focusTerms,
      preference: input.preference ?? existing.preference,
      frequencyBand: input.frequencyBand ?? existing.frequencyBand,
      practiceEnabled: input.practiceEnabled ?? existing.practiceEnabled,
    });
  }

  delete(publicId: string) {
    const existing = this.get(publicId);
    if (!existing) return false;
    logChange(this.db, "user", "delete", "item", publicId, existing, null);
    this.db.prepare("DELETE FROM items WHERE public_id = ?").run(publicId);
    return true;
  }

  deleteMany(publicIds: string[]) {
    const uniqueIds = [...new Set(publicIds)];
    const items = uniqueIds.map((publicId) => this.get(publicId));
    if (items.some((item) => !item)) return null;
    const remove = this.db.prepare("DELETE FROM items WHERE public_id = ?");
    const transaction = this.db.transaction(() => {
      items.forEach((item, index) => {
        logChange(this.db, "user", "delete", "item", uniqueIds[index], item, null);
        remove.run(uniqueIds[index]);
      });
    });
    transaction();
    return uniqueIds;
  }

  search(query: string, language: LanguageCode, embedding?: number[], limit = 20): SearchResult[] {
    query = normalizeNfc(query.trim());
    const keywordScores = new Map<string, number>();
    const itemById = new Map<string, LearningItem>();
    const ftsQuery = makeFtsQuery(query);

    if (ftsQuery) {
      const rows = this.db.prepare(
        `SELECT i.*, bm25(items_fts, 4.0, 1.5, 0.8, 0.3) AS keyword_rank
         FROM items_fts
         JOIN items i ON i.id = items_fts.rowid
         WHERE items_fts MATCH ? AND i.language_code = ?
         ORDER BY keyword_rank
         LIMIT 50`,
      ).all(ftsQuery, language) as Array<ItemRow & { keyword_rank: number }>;
      rows.forEach((row, index) => {
        const item = mapItem(row);
        itemById.set(item.publicId, item);
        keywordScores.set(item.publicId, Math.max(0.2, 1 - index / 55));
      });
    }

    const semanticScores = new Map<string, number>();
    if (embedding?.length) {
      const rows = this.db.prepare(
        "SELECT * FROM items WHERE language_code = ? AND embedding IS NOT NULL",
      ).all(language) as ItemRow[];
      rows.map((row) => ({ row, score: cosineSimilarity(embedding, row.embedding!) }))
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
      const rows = this.db.prepare(
        `SELECT * FROM items
         WHERE language_code = ?
           AND (lower(target) LIKE ? OR lower(cue) LIKE ? OR lower(note) LIKE ?)
         ORDER BY naturalness DESC, commonness DESC
         LIMIT ?`,
      ).all(language, like, like, like, limit) as ItemRow[];
      rows.forEach((row, index) => {
        const item = mapItem(row);
        itemById.set(item.publicId, item);
        keywordScores.set(item.publicId, Math.max(0.2, 1 - index / (limit + 2)));
      });
    }

    return [...itemById.values()].map((item) => {
      const keyword = keywordScores.get(item.publicId) || 0;
      const semantic = semanticScores.get(item.publicId) || 0;
      const quality = (item.naturalness + item.commonness) / 10;
      return {
        ...item,
        score: Number((keyword * 0.55 + semantic * 0.4 + quality * 0.05).toFixed(4)),
        match: keyword && semantic ? "hybrid" : semantic ? "semantic" : "keyword",
      } as SearchResult;
    }).sort((left, right) => right.score - left.score).slice(0, limit);
  }

  missingEmbeddings(limit = 100) {
    return (this.db.prepare(
      "SELECT * FROM items WHERE embedding IS NULL ORDER BY id LIMIT ?",
    ).all(limit) as ItemRow[]).map(mapItem);
  }

  updateEmbedding(publicId: string, vector: number[], model: string) {
    this.db.prepare(
      `UPDATE items SET embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(vectorToBuffer(vector), model, publicId);
  }
}
