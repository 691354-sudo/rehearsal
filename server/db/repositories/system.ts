import type { RehearsalDatabase } from "../database.js";

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
}
