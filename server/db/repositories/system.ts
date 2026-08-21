import type { RehearsalDatabase } from "../database.js";
import { languageCatalog, type LanguageCode, type LanguageOption } from "../../../contracts/api.js";

type LanguageRow = { code: LanguageCode; name: string; locale: string; enabled: number };
type LanguageResource = "item" | "island" | "thread" | "reviewBatch" | "capture";

const resourceTables: Record<LanguageResource, string> = {
  item: "items",
  island: "islands",
  thread: "chat_threads",
  reviewBatch: "review_batches",
  capture: "capture_notes",
};

export class SystemRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  stats() {
    const items = this.db.prepare(
      "SELECT language_code, COUNT(*) AS count FROM items GROUP BY language_code",
    ).all();
    const sources = this.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
    const attempts = this.db.prepare("SELECT COUNT(*) AS count FROM attempts").get() as { count: number };
    return { items, sources: sources.count, attempts: attempts.count };
  }

  quickCheck() {
    const row = this.db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    return row.quick_check === "ok";
  }

  listLanguages(enabledOnly = true): LanguageOption[] {
    const rows = this.db.prepare(
      `SELECT code, name, locale, enabled FROM languages
       ${enabledOnly ? "WHERE enabled = 1" : ""}
       ORDER BY CASE code WHEN 'en' THEN 0 WHEN 'lv' THEN 1 WHEN 'vi' THEN 2 ELSE 3 END`,
    ).all() as LanguageRow[];
    return rows.map((row) => ({
      code: row.code,
      label: row.name,
      locale: row.locale,
      capabilities: languageCatalog[row.code].capabilities,
    }));
  }

  isLanguageEnabled(language: LanguageCode) {
    const row = this.db.prepare("SELECT enabled FROM languages WHERE code = ?")
      .get(language) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  setLanguageEnabled(language: LanguageCode, enabled: boolean) {
    const result = this.db.prepare("UPDATE languages SET enabled = ? WHERE code = ?")
      .run(enabled ? 1 : 0, language);
    if (!result.changes) throw new Error(`Unknown language: ${language}`);
    return this.listLanguages(false).find((option) => option.code === language)!;
  }

  resourceLanguage(resource: LanguageResource, publicId: string) {
    const table = resourceTables[resource];
    const row = this.db.prepare(`SELECT language_code FROM ${table} WHERE public_id = ?`)
      .get(publicId) as { language_code: LanguageCode } | undefined;
    return row?.language_code || null;
  }

  itemLanguages(publicIds: string[]) {
    if (!publicIds.length) return [] as LanguageCode[];
    const placeholders = publicIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT DISTINCT language_code FROM items WHERE public_id IN (${placeholders})`,
    ).all(...publicIds) as Array<{ language_code: LanguageCode }>;
    return rows.map((row) => row.language_code);
  }
}
