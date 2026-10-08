import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createApiTestContext } from "../../testing/api-test-context.js";

describe("ready-to-run Tutor SQL report", () => {
  it("returns labeled period and all-time totals without reading private messages", () => {
    const context = createApiTestContext();
    try {
      const a = context.repository.tutor.adaptation;
      a.start("en"); a.complete("en", "ru", true);
      a.update("en", "ru", { mode: "beginner" }, "direct_request");
      a.event("en", "tutor_summary_error");
      const sql = fs.readFileSync(new URL("../../../scripts/sql/tutor-adaptation-report.sql", import.meta.url), "utf8");
      const [parameters, query] = sql.split("-- REPORT QUERY");
      context.db.exec(parameters);
      const rows = context.db.prepare(query).all();
      expect(rows).toContainEqual({ period: "All time", metric: "Users who started onboarding", value: 1, unit: "users in this profile database" });
      expect(rows).toContainEqual({ period: "Selected period", metric: "Direct requests changing mode", value: 1, unit: "events" });
      expect(rows).toContainEqual({ period: "All time", metric: "Session summary errors", value: 1, unit: "events" });
      expect(sql).not.toContain("chat_messages");
    } finally { context.close(); }
  });
});
