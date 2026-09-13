import { randomUUID } from "node:crypto";
import type { LanguageCode, LearningProgressSummary } from "../../../contracts/api.js";
import { categoryTitleKey, type CardCategoriesInput, type LearningCategory, type LearningCategoryDraft } from "../../../contracts/learning-categories.js";
import type { RehearsalDatabase } from "../database.js";
import { logChange, mapItemWithProgress, type DueItemRow } from "./shared.js";

type CategoryRow = {
  id: number; public_id: string; language_code: LanguageCode; title: string;
  title_key: string; description: string; created_at: string; updated_at: string;
};
const emptyProgress = (): LearningProgressSummary => ({
  new: 0, learning: 0, due: 0, strong: 0, learned: 0, dueNow: 0, recalls: 0, listens: 0,
});

export class LearningCategoriesRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  catalog(language: LanguageCode) {
    return (this.db.prepare("SELECT * FROM learning_categories WHERE language_code = ? ORDER BY title COLLATE NOCASE, id")
      .all(language) as CategoryRow[]).map((row) => ({ publicId: row.public_id, language: row.language_code,
      title: row.title, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  list(language: LanguageCode, now = new Date()) {
    const categories = this.catalog(language).map((category) => ({ ...category, itemCount: 0, progress: emptyProgress() }));
    const byId = new Map(categories.map((category) => [category.publicId, category]));
    for (const row of this.rows(language)) {
      const category = byId.get(row.category_public_id)!;
      const item = mapItemWithProgress(row, now);
      category.itemCount++;
      category.progress[item.progress.stage]++;
      category.progress.recalls += item.progress.recalls;
      category.progress.listens += item.progress.listens;
      if (item.practiceEnabled && row.review_due_at && new Date(row.review_due_at) <= now) category.progress.dueNow++;
    }
    return categories;
  }

  get(publicId: string, now = new Date()): LearningCategory | null {
    const category = this.row(publicId);
    if (!category) return null;
    const summary = this.list(category.language_code, now).find((entry) => entry.publicId === publicId)!;
    return { ...summary, items: this.rows(category.language_code, publicId).map((row) => mapItemWithProgress(row, now)) };
  }

  private rows(language: LanguageCode, publicId?: string) {
    return this.db.prepare(`SELECT i.*, c.public_id AS category_public_id,
      r.due_at AS review_due_at, r.state AS review_state,
      COALESCE(a.recall_count, 0) AS recall_count, COALESCE(a.listen_count, 0) AS listen_count
      FROM learning_category_items ci JOIN learning_categories c ON c.id = ci.category_id
      JOIN learning_items i ON i.id = ci.item_id LEFT JOIN review_state r ON r.item_id = i.id
      LEFT JOIN (SELECT item_id, SUM(mode = 'recall') AS recall_count,
        SUM(mode IN ('listen', 'shadow')) AS listen_count FROM attempts GROUP BY item_id) a ON a.item_id = i.id
      WHERE c.language_code = ? AND (? IS NULL OR c.public_id = ?) ORDER BY i.created_at, i.id`)
      .all(language, publicId ?? null, publicId ?? null) as Array<DueItemRow & { category_public_id: string }>;
  }

  private row(publicId: string) {
    return this.db.prepare("SELECT * FROM learning_categories WHERE public_id = ?").get(publicId) as CategoryRow | undefined;
  }

  create(input: { language: LanguageCode; title: string; description?: string; publicId?: string }) {
    const publicId = input.publicId ?? randomUUID();
    const existing = this.row(publicId);
    if (existing) {
      if (existing.language_code === input.language && existing.title_key === categoryTitleKey(input.title)
        && existing.description === (input.description?.trim() || "")) return this.get(publicId)!;
      throw new Error("CATEGORY_ID_CONFLICT");
    }
    if (this.catalog(input.language).some((category) => categoryTitleKey(category.title) === categoryTitleKey(input.title))) {
      throw new Error("CATEGORY_TITLE_EXISTS");
    }
    this.db.prepare(`INSERT INTO learning_categories(public_id, language_code, title, title_key, description)
      VALUES (?, ?, ?, ?, ?)`).run(publicId, input.language, input.title.trim(), categoryTitleKey(input.title), input.description?.trim() || "");
    logChange(this.db, "user", "create", "learning_category", publicId, null, input);
    return this.get(publicId)!;
  }

  update(publicId: string, input: { title?: string; description?: string }) {
    const before = this.row(publicId);
    if (!before) return null;
    const title = input.title?.trim() ?? before.title;
    if (this.catalog(before.language_code).some((entry) => entry.publicId !== publicId && categoryTitleKey(entry.title) === categoryTitleKey(title))) {
      throw new Error("CATEGORY_TITLE_EXISTS");
    }
    this.db.transaction(() => {
      this.db.prepare("UPDATE learning_categories SET title = ?, title_key = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?")
        .run(title, categoryTitleKey(title), input.description?.trim() ?? before.description, publicId);
      logChange(this.db, "user", "update", "learning_category", publicId, before, this.row(publicId));
    })();
    return this.get(publicId)!;
  }

  delete(publicId: string) {
    const before = this.row(publicId);
    if (!before) return false;
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM learning_categories WHERE public_id = ?").run(publicId);
      logChange(this.db, "user", "delete", "learning_category", publicId, before, null);
    })();
    return true;
  }

  /** Resolve only categories present in this profile and the card's language. */
  validate(language: LanguageCode, publicIds: string[]) {
    return [...new Set(publicIds)].map((publicId) => {
      const category = this.row(publicId);
      if (!category) throw new Error("CATEGORY_NOT_FOUND");
      if (category.language_code !== language) throw new Error("CATEGORY_LANGUAGE_MISMATCH");
      return category.id;
    });
  }

  resolveDraft(language: LanguageCode, input: CardCategoriesInput) {
    const drafts: LearningCategoryDraft[] = input.newLearningCategories ?? [];
    const aliases = new Map(drafts.map((draft) => {
      const existing = this.catalog(language).find((category) => categoryTitleKey(category.title) === categoryTitleKey(draft.title));
      const category = existing ?? this.create({ ...draft, language });
      return [draft.publicId, category.publicId];
    }));
    const ids = [...new Set([...(input.learningCategoryIds ?? []), ...drafts.map((draft) => draft.publicId)]
      .map((id) => aliases.get(id) ?? id))];
    this.validate(language, ids);
    return ids;
  }

  setForCard(itemPublicId: string, publicIds: string[]) {
    this.db.transaction(() => {
      const item = this.item(itemPublicId);
      const categoryIds = this.validate(item.language_code, publicIds);
      this.db.prepare("DELETE FROM learning_category_items WHERE item_id = ?").run(item.id);
      for (const categoryId of categoryIds) this.db.prepare("INSERT INTO learning_category_items(category_id, item_id) VALUES (?, ?)").run(categoryId, item.id);
    })();
  }

  addToCards(language: LanguageCode, categoryPublicIds: string[], itemPublicIds: string[]) {
    this.db.transaction(() => {
      const categoryIds = this.validate(language, categoryPublicIds);
      const items = [...new Set(itemPublicIds)].map((id) => this.item(id));
      if (items.some((item) => item.language_code !== language)) throw new Error("CATEGORY_LANGUAGE_MISMATCH");
      const add = this.db.prepare("INSERT OR IGNORE INTO learning_category_items(category_id, item_id) VALUES (?, ?)");
      for (const categoryId of categoryIds) for (const item of items) add.run(categoryId, item.id);
      logChange(this.db, "user", "add_cards", "learning_category", categoryPublicIds.join(","), null, { itemPublicIds });
    })();
  }

  removeCards(publicId: string, itemPublicIds: string[]) {
    const category = this.row(publicId);
    if (!category) throw new Error("CATEGORY_NOT_FOUND");
    this.db.transaction(() => {
      const items = itemPublicIds.map((id) => this.item(id));
      if (items.some((item) => item.language_code !== category.language_code)) throw new Error("CATEGORY_LANGUAGE_MISMATCH");
      const remove = this.db.prepare("DELETE FROM learning_category_items WHERE category_id = ? AND item_id = ?");
      for (const item of items) remove.run(category.id, item.id);
      logChange(this.db, "user", "remove_cards", "learning_category", publicId, { itemPublicIds }, null);
    })();
  }

  redirects(language: LanguageCode) {
    return this.db.prepare(`SELECT r.topic_public_id AS topicId, c.public_id AS categoryId
      FROM topic_category_redirects r JOIN learning_categories c ON c.id = r.category_id WHERE c.language_code = ?`)
      .all(language) as Array<{ topicId: string; categoryId: string }>;
  }

  private item(publicId: string) {
    const item = this.db.prepare("SELECT id, language_code FROM items WHERE public_id = ?")
      .get(publicId) as { id: number; language_code: LanguageCode } | undefined;
    if (!item) throw new Error("ITEM_NOT_FOUND");
    return item;
  }
}
