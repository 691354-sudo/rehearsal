import type Database from "better-sqlite3";

/** Preserve event IDs and foreign keys while removing the pilot's English-only constraint. */
export const migrateUnifiedLearning = (db: Database.Database) => {
  for (const table of ["pilot_events", "pilot_homework"]) {
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string };
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table) as { sql: string }[];
    db.exec(sql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${table}_next`).replace("CHECK (language = 'en')", "CHECK (language IN ('en','lv','vi','no','id'))"));
    db.exec(`INSERT INTO ${table}_next SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_next RENAME TO ${table};`);
    for (const index of indexes) db.exec(index.sql);
  }
  db.exec(`
    ALTER TABLE pilot_card_progress ADD COLUMN stage TEXT NOT NULL DEFAULT 'listen' CHECK(stage IN ('listen','recall','tutor'));
    ALTER TABLE pilot_card_progress ADD COLUMN listen_target INTEGER NOT NULL DEFAULT 5;
    ALTER TABLE pilot_card_progress ADD COLUMN last_credited_at TEXT;
    ALTER TABLE pilot_card_progress ADD COLUMN entered_at TEXT;
    ALTER TABLE pilot_card_progress ADD COLUMN last_rating TEXT;
    ALTER TABLE pilot_card_progress ADD COLUMN last_good_at TEXT;
    ALTER TABLE pilot_card_progress ADD COLUMN again_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pilot_card_progress ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pilot_card_progress ADD COLUMN entry_pending INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pilot_attempts ADD COLUMN progress_revision INTEGER;
    ALTER TABLE pilot_attempts ADD COLUMN practice_session_id TEXT;
    CREATE TABLE practice_sessions (
      session_id TEXT PRIMARY KEY, language TEXT NOT NULL, card_ids TEXT NOT NULL,
      created_at TEXT NOT NULL, request TEXT NOT NULL
    );
    CREATE TABLE tutor_core_links (
      card_id TEXT PRIMARY KEY REFERENCES items(public_id) ON DELETE CASCADE, language TEXT NOT NULL, core TEXT NOT NULL, target TEXT NOT NULL
    );
    DROP TRIGGER pilot_preference_unlike;
    INSERT OR IGNORE INTO pilot_card_progress(card_id) SELECT public_id FROM items;
  `);
  // attempts mirrors pilot listens by event ID. Count that event only once.
  db.exec(`UPDATE pilot_card_progress AS p SET
    listen_count = MAX(listen_count, (SELECT COUNT(*) FROM attempts a JOIN items i ON i.id=a.item_id
      WHERE i.public_id=p.card_id AND a.mode IN ('listen','shadow')) +
      (SELECT COUNT(*) FROM pilot_listens l WHERE l.card_id=p.card_id
       AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.public_id=l.event_id))),
    last_listen_at = (SELECT MAX(strftime('%Y-%m-%dT%H:%M:%fZ', at)) FROM (
      SELECT MAX(a.created_at) AS at FROM attempts a JOIN items i ON i.id=a.item_id WHERE i.public_id=p.card_id AND a.mode IN ('listen','shadow')
      UNION ALL SELECT MAX(completed_at) FROM pilot_listens WHERE card_id=p.card_id
      UNION ALL SELECT p.last_listen_at));
    UPDATE pilot_card_progress SET last_credited_at=last_listen_at;
    UPDATE pilot_card_progress AS p SET stage='recall', entered_at=COALESCE(recall_eligible_at,last_listen_at,CURRENT_TIMESTAMP),
      recall_eligible_at=COALESCE(recall_eligible_at,last_listen_at,CURRENT_TIMESTAMP),
      entry_pending=CASE WHEN EXISTS(SELECT 1 FROM attempts a JOIN items i ON i.id=a.item_id WHERE i.public_id=p.card_id AND a.mode='recall') THEN 0 ELSE 1 END
    WHERE listen_count>=5 OR EXISTS(SELECT 1 FROM items i WHERE i.public_id=p.card_id AND (i.language_code='lv'
      OR EXISTS(SELECT 1 FROM attempts a WHERE a.item_id=i.id AND a.mode='recall')));
    CREATE TRIGGER learning_new_card AFTER INSERT ON items BEGIN
      INSERT OR IGNORE INTO pilot_card_progress(card_id,stage,entered_at,recall_eligible_at,entry_pending)
      VALUES(new.public_id,CASE WHEN new.language_code='lv' THEN 'recall' ELSE 'listen' END,new.created_at,
        CASE WHEN new.language_code='lv' THEN new.created_at ELSE NULL END,CASE WHEN new.language_code='lv' THEN 1 ELSE 0 END);
    END;
    UPDATE pilot_priority_requests SET status='cancelled',assigned=0,cancelled_at=CURRENT_TIMESTAMP WHERE status='pending' AND assigned=0;
  `);
};
