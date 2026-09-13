import { createHash } from "node:crypto";
import { z } from "zod";
import type { RehearsalDatabase } from "./database.js";
import { LearningCategoriesRepository } from "./repositories/learning-categories.js";
import { LibraryRepository } from "./repositories/library.js";
import { categoryTitleKey } from "../../contracts/learning-categories.js";
import { languageCodes } from "../../contracts/api.js";

export const categoryAssignmentSchema = z.object({
  language: z.enum(languageCodes as [typeof languageCodes[number], ...typeof languageCodes]),
  categories: z.array(z.object({
    publicId: z.string().uuid(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(2_000),
    cards: z.array(z.object({ publicId: z.string().min(1), expectedTarget: z.string().min(1), expectedFocusTerms: z.array(z.string()).optional() })).max(10_000),
  })).min(1).max(100),
  topicMoves: z.array(z.object({ cardId: z.string().min(1), fromTopicId: z.string().uuid(), toTopicId: z.string().uuid() })).max(10_000).default([]),
  convertTopics: z.array(z.object({ topicId: z.string().uuid(), categoryId: z.string().uuid() })).max(100).default([]),
});
export type CategoryAssignmentPlan = z.infer<typeof categoryAssignmentSchema>;
export const categoryAssignmentHash = (plan: CategoryAssignmentPlan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");

const unchangedDigest = (db: RehearsalDatabase) => createHash("sha256")
  .update(JSON.stringify(db.prepare("SELECT * FROM items ORDER BY id").all()))
  .update(JSON.stringify(db.prepare("SELECT * FROM attempts ORDER BY id").all()))
  .update(JSON.stringify(db.prepare("SELECT * FROM review_state ORDER BY item_id").all()))
  .update(JSON.stringify(db.prepare("SELECT * FROM pilot_attempts ORDER BY attempt_id").all()))
  .update(JSON.stringify(db.prepare("SELECT * FROM pilot_card_progress ORDER BY card_id").all())).digest("hex");

export function previewCategoryAssignments(db: RehearsalDatabase, plan: CategoryAssignmentPlan) {
  const categories = new LearningCategoriesRepository(db);
  const library = new LibraryRepository(db);
  const hash = categoryAssignmentHash(plan);
  const applied = Boolean(db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(`category_assignment:${hash}`));
  if (new Set(plan.categories.map((category) => category.publicId)).size !== plan.categories.length
    || new Set(plan.categories.map((category) => categoryTitleKey(category.title))).size !== plan.categories.length) {
    throw new Error("ASSIGNMENT_DUPLICATE_CATEGORY");
  }
  if (new Set(plan.topicMoves.map((move) => move.cardId)).size !== plan.topicMoves.length) throw new Error("ASSIGNMENT_DUPLICATE_MOVE");
  for (const category of plan.categories) {
    const existing = categories.get(category.publicId);
    if (existing && (existing.language !== plan.language || categoryTitleKey(existing.title) !== categoryTitleKey(category.title))) {
      throw new Error("ASSIGNMENT_CATEGORY_CONFLICT");
    }
    const sameTitle = categories.catalog(plan.language).find((entry) => categoryTitleKey(entry.title) === categoryTitleKey(category.title));
    if (sameTitle && sameTitle.publicId !== category.publicId) throw new Error("ASSIGNMENT_CATEGORY_CONFLICT");
    if (new Set(category.cards.map((card) => card.publicId)).size !== category.cards.length) throw new Error("ASSIGNMENT_DUPLICATE_CARD");
    for (const card of category.cards) {
      const saved = db.prepare("SELECT target, focus_terms FROM items WHERE public_id = ? AND language_code = ?").get(card.publicId, plan.language) as { target: string; focus_terms: string } | undefined;
      if (!saved || saved.target !== card.expectedTarget || (card.expectedFocusTerms && JSON.stringify(card.expectedFocusTerms) !== JSON.stringify(JSON.parse(saved.focus_terms)))) throw new Error(`ASSIGNMENT_CARD_CHANGED:${card.publicId}`);
    }
  }
  for (const move of plan.topicMoves) {
    const topic = library.getIsland(move.toTopicId);
    if (!topic || topic.language !== plan.language) throw new Error("ASSIGNMENT_DESTINATION_NOT_FOUND");
    const owner = db.prepare("SELECT topic_public_id FROM learning_items WHERE public_id = ? AND language_code = ?")
      .get(move.cardId, plan.language) as { topic_public_id: string } | undefined;
    if (!owner || owner.topic_public_id !== (applied ? move.toTopicId : move.fromTopicId)) throw new Error(`ASSIGNMENT_TOPIC_CHANGED:${move.cardId}`);
    if (!plan.categories.some((category) => category.cards.some((card) => card.publicId === move.cardId))) throw new Error("ASSIGNMENT_MOVE_WITHOUT_CARD_CHECK");
  }
  for (const conversion of plan.convertTopics) {
    if (conversion.topicId !== conversion.categoryId) throw new Error("ASSIGNMENT_SET_ID_MUST_BE_PRESERVED");
    if (!plan.categories.some((category) => category.publicId === conversion.categoryId)) throw new Error("ASSIGNMENT_CATEGORY_MISSING");
    const source = library.getIsland(conversion.topicId);
    if (!applied && (!source || source.language !== plan.language)) throw new Error("ASSIGNMENT_SOURCE_NOT_FOUND");
    if (source?.items.some((item) => !plan.topicMoves.some((move) => move.cardId === item.publicId
      && move.fromTopicId === conversion.topicId && move.toTopicId !== conversion.topicId))) throw new Error("ASSIGNMENT_SOURCE_NOT_EMPTY");
  }
  return { hash, applied, categories: plan.categories.map((category) => ({ publicId: category.publicId,
    title: category.title, cards: category.cards.length })), topicMoves: plan.topicMoves.length,
    convertedTopics: plan.convertTopics.length };
}

export function applyCategoryAssignments(db: RehearsalDatabase, plan: CategoryAssignmentPlan) {
  return db.transaction(() => {
    const preview = previewCategoryAssignments(db, plan);
    if (preview.applied) return preview;
    const before = unchangedDigest(db);
    const categories = new LearningCategoriesRepository(db);
    const library = new LibraryRepository(db);
    for (const category of plan.categories) {
      if (!categories.get(category.publicId)) categories.create({ ...category, language: plan.language });
      categories.addToCards(plan.language, [category.publicId], category.cards.map((card) => card.publicId));
    }
    for (const move of plan.topicMoves) library.addIslandItem(move.toTopicId, move.cardId);
    for (const conversion of plan.convertTopics) {
      if (library.getIsland(conversion.topicId)?.itemCount) throw new Error("ASSIGNMENT_SOURCE_NOT_EMPTY");
      db.prepare(`INSERT INTO topic_category_redirects(topic_public_id, category_id)
        SELECT ?, id FROM learning_categories WHERE public_id = ?`).run(conversion.topicId, conversion.categoryId);
      library.deleteIsland(conversion.topicId);
    }
    if (unchangedDigest(db) !== before) throw new Error("ASSIGNMENT_CARD_OR_HISTORY_CHANGED");
    if (db.pragma("quick_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("ASSIGNMENT_INTEGRITY_FAILED");
    db.prepare("INSERT INTO app_settings(key, value) VALUES (?, ?)").run(`category_assignment:${preview.hash}`, new Date().toISOString());
    return { ...preview, applied: true };
  }).immediate();
}
