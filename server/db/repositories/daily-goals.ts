import { dailyGoalDay, dailyGoalsSettingsSchema, defaultDailyGoals,
  type DailyGoalCounts, type DailyGoalKind, type DailyGoalsSettings, type DailyGoalsSnapshot } from "../../../contracts/daily-goals.js";
import type { RehearsalDatabase } from "../database.js";

type Tracking = { startedAt: string; timezone: string };
type SettingsRow = { local_day: string; settings: string };
const dayAt = (time: string, timezone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(time));
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const emptyCounts = (): DailyGoalCounts => ({ listen: 0, recall: 0, tutor: 0 });

export class DailyGoalsError extends Error {}

export class DailyGoalsRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  private tracking() {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'daily_goals'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) as Tracking : null;
  }

  private profileTimezone() {
    const participant = this.db.prepare("SELECT timezone FROM pilot_participants WHERE ended_at IS NULL LIMIT 1").get() as { timezone: string } | undefined;
    const saved = this.db.prepare("SELECT value FROM app_settings WHERE key = 'pilot_timezone'").get() as { value: string } | undefined;
    return participant?.timezone ?? (saved ? JSON.parse(saved.value) as string : "Europe/Riga");
  }

  start(settings = defaultDailyGoals, now = new Date().toISOString()) {
    const valid = dailyGoalsSettingsSchema.parse(settings);
    return this.db.transaction(() => {
      if (!this.tracking()) {
        const tracking = { startedAt: now, timezone: this.profileTimezone() };
        this.db.prepare("INSERT INTO app_settings(key, value) VALUES ('daily_goals', ?)").run(JSON.stringify(tracking));
        this.saveSettings(dayAt(now, tracking.timezone), valid);
      }
      return this.snapshot(now);
    }).immediate();
  }

  update(settings: DailyGoalsSettings, now = new Date().toISOString()) {
    const valid = dailyGoalsSettingsSchema.parse(settings);
    return this.db.transaction(() => {
      const tracking = this.tracking();
      if (!tracking) throw new DailyGoalsError("GOALS_NOT_STARTED");
      this.saveSettings(dayAt(now, tracking.timezone), valid);
      return this.snapshot(now);
    }).immediate();
  }

  private saveSettings(day: string, settings: DailyGoalsSettings) {
    this.db.prepare(`INSERT INTO daily_goal_settings(local_day, settings) VALUES (?, ?)
      ON CONFLICT(local_day) DO UPDATE SET settings = excluded.settings`).run(day, JSON.stringify(settings));
  }

  record(kind: DailyGoalKind, sourceId: string, language: string, occurredAt = new Date().toISOString()) {
    const tracking = this.tracking();
    if (!tracking || Date.parse(occurredAt) < Date.parse(tracking.startedAt)) return;
    this.db.prepare(`INSERT OR IGNORE INTO daily_goal_events(kind, source_id, occurred_at, local_day, language)
      VALUES (?, ?, ?, ?, ?)`).run(kind, sourceId, occurredAt, dayAt(occurredAt, tracking.timezone), language);
  }

  recordTutor(clientMessageId: string) {
    const exchange = this.db.prepare(`SELECT t.language_code, a.created_at FROM chat_messages u
      JOIN chat_threads t ON t.id = u.thread_id
      JOIN chat_messages a ON a.thread_id = u.thread_id AND a.role = 'assistant'
        AND json_extract(a.metadata, '$.clientMessageId') = u.client_message_id
      WHERE u.role = 'user' AND u.client_message_id = ?
        AND COALESCE(json_extract(u.metadata, '$.automaticStart'), 0) = 0
        AND json_extract(a.metadata, '$.mode') = 'openai' LIMIT 1`).get(clientMessageId) as {
      language_code: string; created_at: string;
    } | undefined;
    if (exchange) this.record("tutor", clientMessageId, exchange.language_code,
      exchange.created_at.includes("T") ? exchange.created_at : `${exchange.created_at.replace(" ", "T")}Z`);
  }

  snapshot(now = new Date().toISOString()): DailyGoalsSnapshot {
    const tracking = this.tracking();
    const timezone = tracking?.timezone ?? this.profileTimezone();
    const today = dayAt(now, timezone);
    const settings = this.db.prepare("SELECT * FROM daily_goal_settings WHERE local_day <= ? ORDER BY local_day").all(today) as SettingsRow[];
    const counts = this.db.prepare(`SELECT local_day, kind, COUNT(*) AS total FROM daily_goal_events
      WHERE local_day <= ? GROUP BY local_day, kind`).all(today) as Array<{ local_day: string; kind: DailyGoalKind; total: number }>;
    const byDay = new Map<string, DailyGoalCounts>();
    for (const row of counts) {
      const day = byDay.get(row.local_day) ?? emptyCounts();
      day[row.kind] = row.total; byDay.set(row.local_day, day);
    }
    let currentSettings = defaultDailyGoals;
    let settingIndex = 0;
    let streak = 0;
    let bestStreak = 0;
    let fullDays = 0;
    const history: DailyGoalsSnapshot["history"] = [];
    if (tracking) for (let date = dayAt(tracking.startedAt, timezone); date <= today; date = nextDay(date)) {
      while (settings[settingIndex]?.local_day <= date) currentSettings = JSON.parse(settings[settingIndex++].settings) as DailyGoalsSettings;
      const day = dailyGoalDay(date, currentSettings, byDay.get(date) ?? emptyCounts());
      if (day.anyReached) { streak++; bestStreak = Math.max(bestStreak, streak); }
      else if (date !== today) streak = 0;
      if (date < today && day.allReached) fullDays++;
      history.push(day);
      if (history.length > 28) history.shift();
    }
    return { startedAt: tracking?.startedAt ?? null, timezone, serverTime: now,
      today: history.at(-1) ?? dailyGoalDay(today, currentSettings, emptyCounts()), history,
      streak, bestStreak, fullDays, achievements: [7, 30, 100].map((days) => ({ days, earned: fullDays >= days })) };
  }
}
