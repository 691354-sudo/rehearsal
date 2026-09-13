import type { LanguageCode } from "../../contracts/api.js";
import { likedTopicId } from "../../contracts/learning-pilot.js";
import type { RehearsalDatabase } from "./database.js";

export type CardScope = { topicId?: string; categoryId?: string };

/** SQL targets item alias i; parameters are always bound, including migrated Topic links. */
export const cardScopeSql = (db: RehearsalDatabase, language: LanguageCode, input: CardScope) => {
  let sql = "";
  const parameters: string[] = [];
  let categoryId = input.categoryId;
  if (input.topicId === likedTopicId) sql += " AND i.preference = 'like'";
  else if (input.topicId) {
    const topic = db.prepare("SELECT 1 FROM islands WHERE public_id = ? AND language_code = ?").get(input.topicId, language);
    if (!topic) {
      const redirect = db.prepare(`SELECT c.public_id FROM topic_category_redirects r
        JOIN learning_categories c ON c.id = r.category_id WHERE r.topic_public_id = ? AND c.language_code = ?`)
        .get(input.topicId, language) as { public_id: string } | undefined;
      if (!redirect) throw new Error("TOPIC_NOT_FOUND");
      categoryId = redirect.public_id;
    } else {
      sql += ` AND EXISTS (SELECT 1 FROM island_items ti JOIN islands t ON t.id = ti.island_id
        WHERE ti.item_id = i.id AND t.public_id = ?)`;
      parameters.push(input.topicId);
    }
  }
  if (categoryId) {
    if (!db.prepare("SELECT 1 FROM learning_categories WHERE public_id = ? AND language_code = ?").get(categoryId, language)) {
      throw new Error("CATEGORY_NOT_FOUND");
    }
    sql += ` AND EXISTS (SELECT 1 FROM learning_category_items ci JOIN learning_categories c ON c.id = ci.category_id
      WHERE ci.item_id = i.id AND c.public_id = ?)`;
    parameters.push(categoryId);
  }
  return { sql, parameters };
};
