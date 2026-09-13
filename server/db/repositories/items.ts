import { cardScopeSql } from "../card-scope.js";
import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode, LearningItem, LearningItemInput, SearchResult } from "../../types.js";
import type { CardCategoriesInput } from "../../../contracts/learning-categories.js";
import { LearningCategoriesRepository } from "./learning-categories.js";
import { LibraryRepository } from "./library.js";
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

  private categories() { return new LearningCategoriesRepository(this.db); }

  list(language: LanguageCode, limit = 100) {
    const rows = this.db.prepare(
      `SELECT * FROM learning_items
       WHERE language_code = ?
       ORDER BY CASE status WHEN 'learning' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
                updated_at DESC
       LIMIT ?`,
    ).all(language, limit) as ItemRow[];
    return rows.map(mapItem);
  }

  get(publicId: string) {
    const row = this.db.prepare("SELECT * FROM learning_items WHERE public_id = ?").get(publicId) as ItemRow | undefined;
    return row ? mapItem(row) : null;
  }

  findByTarget(language: LanguageCode, target: string) {
    const key = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    const row = (this.db.prepare("SELECT public_id, target FROM items WHERE language_code = ? ORDER BY id")
      .all(language) as Array<{ public_id: string; target: string }>).find((entry) => key(entry.target) === key(target));
    return row ? this.get(row.public_id) : null;
  }

  create(input: LearningItemInput, topicPublicId: string) {
    const topic = this.db.prepare(
      "SELECT id, language_code FROM islands WHERE public_id = ?",
    ).get(topicPublicId) as { id: number; language_code: LanguageCode } | undefined;
    if (!topic) throw new Error("TOPIC_NOT_FOUND");
    if (topic.language_code !== input.language) throw new Error("TOPIC_LANGUAGE_MISMATCH");
    return this.db.transaction(() => {
      const previous = input.publicId ? this.get(input.publicId) : null;
      if (previous) {
        const categoryIds = this.categories().resolveDraft(input.language, input);
        if (previous.language !== input.language || previous.target !== normalizeNfc(input.target.trim())
          || previous.cue !== input.cue.trim() || previous.note !== (input.note?.trim() || "")
          || previous.topicId !== topicPublicId || previous.frequencyBand !== (input.frequencyBand ?? "common")
          || JSON.stringify([...(previous.learningCategoryIds ?? [])].sort()) !== JSON.stringify(categoryIds.sort())
          || JSON.stringify(previous.focusTerms) !== JSON.stringify(input.focusTerms ?? [])) throw new Error("ITEM_ID_CONFLICT");
        return previous;
      }
      const item = this.save(input);
      const itemRow = this.db.prepare("SELECT id FROM items WHERE public_id = ?")
        .get(item.publicId) as { id: number };
      const position = (this.db.prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM island_items WHERE island_id = ?",
      ).get(topic.id) as { position: number }).position;
      this.db.prepare(
        "INSERT INTO island_items(island_id, item_id, position) VALUES (?, ?, ?)",
      ).run(topic.id, itemRow.id, position);
      const ids = this.categories().resolveDraft(input.language, input);
      this.categories().setForCard(item.publicId, ids);
      return this.get(item.publicId)!;
    })();
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
  >> & CardCategoriesInput & { topicId?: string }) {
    const existing = this.get(publicId);
    if (!existing) return null;
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE items SET target = ?, cue = ?, note = ?, tags = ?, focus_terms = ?,
        preference = ?, frequency_band = ?, practice_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?`)
        .run(input.target === undefined ? existing.target : normalizeNfc(input.target.trim()),
          input.cue?.trim() ?? existing.cue, input.note?.trim() ?? existing.note,
          JSON.stringify(input.tags ?? existing.tags), JSON.stringify(input.focusTerms ?? existing.focusTerms),
          input.preference ?? existing.preference, input.frequencyBand ?? existing.frequencyBand,
          (input.practiceEnabled ?? existing.practiceEnabled) ? 1 : 0, publicId);
      if (input.topicId && input.topicId !== existing.topicId) {
        const library = new LibraryRepository(this.db);
        const topic = library.getIsland(input.topicId);
        if (!topic) throw new Error("TOPIC_NOT_FOUND");
        if (topic.language !== existing.language) throw new Error("TOPIC_LANGUAGE_MISMATCH");
        library.addIslandItem(input.topicId, publicId);
      }
      if (input.learningCategoryIds !== undefined || input.newLearningCategories?.length) {
        const ids = this.categories().resolveDraft(existing.language, {
          ...input, learningCategoryIds: input.learningCategoryIds ?? existing.learningCategoryIds,
        });
        this.categories().setForCard(publicId, ids);
      }
      const updated = this.get(publicId)!;
      logChange(this.db, "user", "update", "item", publicId, existing, updated);
      return updated;
    })();
  }

  delete(publicId: string) {
    const existing = this.get(publicId);
    if (!existing) return false;
    this.db.transaction(() => {
      logChange(this.db, "user", "delete", "item", publicId, existing, null);
      this.db.prepare("DELETE FROM items WHERE public_id = ?").run(publicId);
    })();
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

  search(query: string, language: LanguageCode, embedding?: number[], limit = 20, categoryId?: string): SearchResult[] {
    query = normalizeNfc(query.trim());
    const filter = cardScopeSql(this.db, language, { categoryId });
    const keywordScores = new Map<string, number>();
    const itemById = new Map<string, LearningItem>();
    const ftsQuery = makeFtsQuery(query);

    if (ftsQuery) {
      const rows = this.db.prepare(
        `SELECT i.*, bm25(items_fts, 4.0, 1.5, 0.8, 0.3) AS keyword_rank
         FROM items_fts
         JOIN learning_items i ON i.id = items_fts.rowid
         WHERE items_fts MATCH ? AND i.language_code = ? ${filter.sql}
         ORDER BY keyword_rank
         LIMIT 50`,
      ).all(ftsQuery, language, ...filter.parameters) as Array<ItemRow & { keyword_rank: number }>;
      rows.forEach((row, index) => {
        const item = mapItem(row);
        itemById.set(item.publicId, item);
        keywordScores.set(item.publicId, Math.max(0.2, 1 - index / 55));
      });
    }

    const semanticScores = new Map<string, number>();
    if (embedding?.length) {
      const rows = this.db.prepare(
        `SELECT i.* FROM learning_items i WHERE language_code = ? AND embedding IS NOT NULL ${filter.sql}`,
      ).all(language, ...filter.parameters) as ItemRow[];
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
        `SELECT i.* FROM learning_items i
         WHERE language_code = ?
           AND (lower(target) LIKE ? OR lower(cue) LIKE ? OR lower(note) LIKE ?) ${filter.sql}
         ORDER BY naturalness DESC, commonness DESC
         LIMIT ?`,
      ).all(language, like, like, like, ...filter.parameters, limit) as ItemRow[];
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
      "SELECT * FROM learning_items WHERE embedding IS NULL ORDER BY id LIMIT ?",
    ).all(limit) as ItemRow[]).map(mapItem);
  }

  updateEmbedding(publicId: string, vector: number[], model: string) {
    this.db.prepare(
      `UPDATE items SET embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP
       WHERE public_id = ?`,
    ).run(vectorToBuffer(vector), model, publicId);
  }
}
