import type Database from "better-sqlite3";

export const migrateLearningCategories = (db: Database.Database) => {
  db.exec(`
    CREATE TABLE learning_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      language_code TEXT NOT NULL REFERENCES languages(code),
      title TEXT NOT NULL,
      title_key TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(language_code, title_key)
    );
    CREATE TABLE learning_category_items (
      category_id INTEGER NOT NULL REFERENCES learning_categories(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      PRIMARY KEY(category_id, item_id)
    );
    CREATE INDEX idx_learning_category_item ON learning_category_items(item_id);
    CREATE TRIGGER learning_category_language BEFORE INSERT ON learning_category_items
    WHEN (SELECT language_code FROM learning_categories WHERE id = NEW.category_id)
      != (SELECT language_code FROM items WHERE id = NEW.item_id)
    BEGIN SELECT RAISE(ABORT, 'CATEGORY_LANGUAGE_MISMATCH'); END;
    CREATE TRIGGER learning_card_delete AFTER DELETE ON items BEGIN
      DELETE FROM pilot_attempts WHERE card_id = OLD.public_id;
      DELETE FROM pilot_card_progress WHERE card_id = OLD.public_id;
      UPDATE pilot_priority_requests SET status = 'cancelled', assigned = 0,
        cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE card_id = OLD.public_id AND status = 'pending';
    END;
    CREATE TABLE topic_category_redirects (
      topic_public_id TEXT PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES learning_categories(id) ON DELETE CASCADE
    );
    CREATE VIEW learning_items AS SELECT i.*,
      (SELECT t.public_id FROM island_items ti JOIN islands t ON t.id = ti.island_id
        WHERE ti.item_id = i.id ORDER BY ti.rowid LIMIT 1) AS topic_public_id,
      (SELECT json_group_array(c.public_id) FROM learning_category_items ci
        JOIN learning_categories c ON c.id = ci.category_id WHERE ci.item_id = i.id)
        AS learning_category_ids
      FROM items i;
  `);
};
