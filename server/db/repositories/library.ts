import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { Island, IslandSummary, LanguageCode } from "../../types.js";
import { logChange, mapItemWithProgress, parseArray, type DueItemRow } from "./shared.js";

type IslandRow = {
  public_id: string;
  language_code: LanguageCode;
  title: string;
  description: string;
  item_count: number;
  progress_new: number;
  progress_learning: number;
  progress_due: number;
  progress_strong: number;
  progress_learned: number;
  due_now: number;
  recall_count: number;
  listen_count: number;
  created_at: string;
  updated_at: string;
};

const normalizeTopicKey = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const mapIslandSummary = (row: IslandRow): IslandSummary => ({
  publicId: row.public_id,
  language: row.language_code,
  title: row.title,
  description: row.description,
  itemCount: row.item_count,
  progress: {
    new: row.progress_new || 0,
    learning: row.progress_learning || 0,
    due: row.progress_due || 0,
    strong: row.progress_strong || 0,
    learned: row.progress_learned || 0,
    dueNow: row.due_now || 0,
    recalls: row.recall_count || 0,
    listens: row.listen_count || 0,
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class LibraryRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  saveSource(input: {
    publicId?: string;
    language: LanguageCode;
    title: string;
    rawText: string;
    kind?: string;
    metadata?: Record<string, unknown>;
  }) {
    const publicId = input.publicId || randomUUID();
    this.db.prepare(
      `INSERT INTO sources(public_id, language_code, title, kind, raw_text, metadata)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(public_id) DO UPDATE SET language_code = excluded.language_code,
       title = excluded.title, kind = excluded.kind, raw_text = excluded.raw_text,
       metadata = excluded.metadata`,
    ).run(
      publicId,
      input.language,
      input.title.trim(),
      input.kind || "text",
      input.rawText,
      JSON.stringify(input.metadata || {}),
    );
    logChange(this.db, input.publicId ? "system" : "user", "create", "source", publicId, null, {
      language: input.language,
      title: input.title,
      characters: input.rawText.length,
    });
    return { publicId };
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
      const result = this.db.prepare(
        "INSERT INTO islands(public_id, language_code, title, description) VALUES (?, ?, ?, ?)",
      ).run(publicId, input.language, input.title, input.description || "");
      const islandId = Number(result.lastInsertRowid);
      const add = this.db.prepare(
        "INSERT OR IGNORE INTO island_items(island_id, item_id, position) VALUES (?, ?, ?)",
      );
      (input.itemPublicIds || []).forEach((itemPublicId, index) => {
        const item = this.db.prepare("SELECT id FROM items WHERE public_id = ? AND language_code = ?")
          .get(itemPublicId, input.language) as { id: number } | undefined;
        if (!item) throw new Error("TOPIC_ITEM_NOT_FOUND");
        add.run(islandId, item.id, index);
      });
    });
    transaction();
    logChange(this.db, actor, "create", "island", publicId, null, input);
    return this.getIsland(publicId)!;
  }

  listIslands(language: LanguageCode, now = new Date()) {
    const rows = this.db.prepare(
      `SELECT i.public_id, i.language_code, i.title, i.description, i.created_at, i.updated_at,
       COUNT(ii.item_id) AS item_count,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) = 0 THEN 1 ELSE 0 END) AS progress_new,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state IN (1, 3) THEN 1 ELSE 0 END) AS progress_learning,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state NOT IN (1, 3)
         AND datetime(r.due_at) <= datetime(?) THEN 1 ELSE 0 END) AS progress_due,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state NOT IN (1, 3)
         AND (r.due_at IS NULL OR datetime(r.due_at) > datetime(?)) THEN 1 ELSE 0 END) AS progress_strong,
       SUM(CASE WHEN item.practice_enabled = 0 THEN 1 ELSE 0 END) AS progress_learned,
       SUM(CASE WHEN item.practice_enabled = 1 AND r.due_at IS NOT NULL
         AND datetime(r.due_at) <= datetime(?) THEN 1 ELSE 0 END) AS due_now,
       SUM(COALESCE(a.recall_count, 0)) AS recall_count,
       SUM(COALESCE(a.listen_count, 0)) AS listen_count
       FROM islands i LEFT JOIN island_items ii ON ii.island_id = i.id
       LEFT JOIN items item ON item.id = ii.item_id
       LEFT JOIN review_state r ON r.item_id = item.id
       LEFT JOIN (
         SELECT item_id,
           SUM(CASE WHEN mode = 'recall' THEN 1 ELSE 0 END) AS recall_count,
           SUM(CASE WHEN mode IN ('listen', 'shadow') THEN 1 ELSE 0 END) AS listen_count
         FROM attempts GROUP BY item_id
       ) a ON a.item_id = item.id
       WHERE i.language_code = ?
       GROUP BY i.id ORDER BY i.title COLLATE NOCASE, i.id`,
    ).all(now.toISOString(), now.toISOString(), now.toISOString(), language) as IslandRow[];
    return rows.map(mapIslandSummary);
  }

  getIsland(publicId: string, now = new Date()): Island | null {
    const row = this.db.prepare(
      `SELECT i.public_id, i.language_code, i.title, i.description, i.created_at, i.updated_at,
       COUNT(ii.item_id) AS item_count,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) = 0 THEN 1 ELSE 0 END) AS progress_new,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state IN (1, 3) THEN 1 ELSE 0 END) AS progress_learning,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state NOT IN (1, 3)
         AND datetime(r.due_at) <= datetime(?) THEN 1 ELSE 0 END) AS progress_due,
       SUM(CASE WHEN item.practice_enabled = 1 AND COALESCE(a.recall_count, 0) > 0 AND r.state NOT IN (1, 3)
         AND (r.due_at IS NULL OR datetime(r.due_at) > datetime(?)) THEN 1 ELSE 0 END) AS progress_strong,
       SUM(CASE WHEN item.practice_enabled = 0 THEN 1 ELSE 0 END) AS progress_learned,
       SUM(CASE WHEN item.practice_enabled = 1 AND r.due_at IS NOT NULL
         AND datetime(r.due_at) <= datetime(?) THEN 1 ELSE 0 END) AS due_now,
       SUM(COALESCE(a.recall_count, 0)) AS recall_count,
       SUM(COALESCE(a.listen_count, 0)) AS listen_count
       FROM islands i LEFT JOIN island_items ii ON ii.island_id = i.id
       LEFT JOIN items item ON item.id = ii.item_id
       LEFT JOIN review_state r ON r.item_id = item.id
       LEFT JOIN (
         SELECT item_id,
           SUM(CASE WHEN mode = 'recall' THEN 1 ELSE 0 END) AS recall_count,
           SUM(CASE WHEN mode IN ('listen', 'shadow') THEN 1 ELSE 0 END) AS listen_count
         FROM attempts GROUP BY item_id
       ) a ON a.item_id = item.id
       WHERE i.public_id = ? GROUP BY i.id`,
    ).get(now.toISOString(), now.toISOString(), now.toISOString(), publicId) as IslandRow | undefined;
    if (!row) return null;
    const items = (this.db.prepare(
      `SELECT items.*,
       r.due_at AS review_due_at, r.stability AS review_stability, r.difficulty AS review_difficulty,
       r.elapsed_days AS review_elapsed_days, r.scheduled_days AS review_scheduled_days,
       r.learning_steps AS review_learning_steps, r.repetitions AS review_repetitions,
       r.lapses AS review_lapses, r.state AS review_state, r.last_review AS review_last_review,
       COALESCE(a.recall_count, 0) AS recall_count, COALESCE(a.listen_count, 0) AS listen_count
       FROM island_items JOIN islands ON islands.id = island_items.island_id
       JOIN items ON items.id = island_items.item_id
       LEFT JOIN review_state r ON r.item_id = items.id
       LEFT JOIN (
         SELECT item_id,
           SUM(CASE WHEN mode = 'recall' THEN 1 ELSE 0 END) AS recall_count,
           SUM(CASE WHEN mode IN ('listen', 'shadow') THEN 1 ELSE 0 END) AS listen_count
         FROM attempts GROUP BY item_id
       ) a ON a.item_id = items.id
       WHERE islands.public_id = ?
       ORDER BY island_items.position, island_items.rowid`,
    ).all(publicId) as DueItemRow[]).map((item) => mapItemWithProgress(item, now));
    return { ...mapIslandSummary(row), items };
  }

  findIslandByTitle(language: LanguageCode, title: string) {
    const normalized = normalizeTopicKey(title);
    return this.listIslands(language)
      .find((island) => normalizeTopicKey(island.title) === normalized) || null;
  }

  ensureIsland(language: LanguageCode, title: string, actor: "llm" | "system" = "system") {
    return this.findIslandByTitle(language, title)
      || this.createIsland({ language, title: title.trim() }, actor);
  }

  addIslandItem(islandPublicId: string, itemPublicId: string) {
    const island = this.db.prepare("SELECT id, language_code FROM islands WHERE public_id = ?")
      .get(islandPublicId) as { id: number; language_code: LanguageCode } | undefined;
    if (!island) throw new Error("TOPIC_NOT_FOUND");
    const item = this.db.prepare("SELECT id FROM items WHERE public_id = ? AND language_code = ?")
      .get(itemPublicId, island.language_code) as { id: number } | undefined;
    if (!item) throw new Error("TOPIC_ITEM_NOT_FOUND");
    const position = (this.db.prepare(
      "SELECT COALESCE(MAX(position), -1) + 1 AS position FROM island_items WHERE island_id = ?",
    ).get(island.id) as { position: number }).position;
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
        "UPDATE islands SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE public_id = ?",
      ).run(nextTitle, input.description?.trim() ?? before.description, publicId);
      if (!input.itemPublicIds) return;
      const islandRow = this.db.prepare("SELECT id FROM islands WHERE public_id = ?")
        .get(publicId) as { id: number };
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
    });
    transaction();
    const updated = this.getIsland(publicId)!;
    logChange(this.db, "user", "update", "island", publicId, before, updated);
    return updated;
  }

  deleteIsland(publicId: string) {
    const before = this.getIsland(publicId);
    if (!before) return false;
    this.db.prepare("DELETE FROM islands WHERE public_id = ?").run(publicId);
    logChange(this.db, "user", "delete", "island", publicId, before, null);
    return true;
  }

  backfillTopicsFromTags(language?: LanguageCode) {
    const languages = language ? [language] : ["en", "lv", "vi"] as const;
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
    const applied = this.db.prepare("SELECT value FROM app_settings WHERE key = 'topics_backfill_v1'")
      .get() as { value: string } | undefined;
    if (applied?.value === "done") return { created: 0, attached: 0, applied: false };
    const result = this.backfillTopicsFromTags();
    this.db.prepare(
      `INSERT INTO app_settings(key, value) VALUES ('topics_backfill_v1', 'done')
       ON CONFLICT(key) DO UPDATE SET value = 'done', updated_at = CURRENT_TIMESTAMP`,
    ).run();
    return { ...result, applied: true };
  }
}
