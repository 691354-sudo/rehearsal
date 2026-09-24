import type Database from "better-sqlite3";

export const migrateGermanLanguage = (db: Database.Database) => {
  for (const table of ["languages", "pilot_events", "pilot_homework"]) {
    const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string };
    if (sql.includes("'de'")) continue;
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table) as { sql: string }[];
    const next = sql.replace(/CREATE TABLE\s+"?\w+"?/, `CREATE TABLE ${table}_next`)
      .replace(/CHECK\s*\(\s*(code|language)\s+IN\s*\([^)]+\)\s*\)/i, "CHECK ($1 IN ('en','lv','vi','no','id','de'))");
    db.exec(next);
    db.exec(`INSERT INTO ${table}_next SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_next RENAME TO ${table};`);
    for (const index of indexes) db.exec(index.sql);
  }
  db.prepare("INSERT OR IGNORE INTO languages(code,name,locale,cue_locale,enabled) VALUES ('de','Deutsch','de-DE','ru-RU',0)").run();
};
