import { z } from "zod";

export const dailyGoalKinds = ["listen", "recall", "tutor"] as const;
export type DailyGoalKind = typeof dailyGoalKinds[number];
const goalSchema = z.object({ enabled: z.boolean(), target: z.number().int().positive() });
export const dailyGoalsSettingsSchema = z.object({ listen: goalSchema, recall: goalSchema, tutor: goalSchema })
  .refine((settings) => dailyGoalKinds.some((kind) => settings[kind].enabled), "Keep at least one goal enabled.");
export type DailyGoalsSettings = z.infer<typeof dailyGoalsSettingsSchema>;
export const defaultDailyGoals: DailyGoalsSettings = {
  listen: { enabled: true, target: 150 },
  recall: { enabled: true, target: 20 },
  tutor: { enabled: true, target: 10 },
};
export type DailyGoalCounts = Record<DailyGoalKind, number>;
export type DailyGoalDay = {
  date: string;
  settings: DailyGoalsSettings;
  counts: DailyGoalCounts;
  completedGoals: number;
  enabledGoals: number;
  anyReached: boolean;
  allReached: boolean;
  status: "empty" | "progress" | "partial" | "complete";
};
export type DailyGoalsSnapshot = {
  startedAt: string | null;
  timezone: string;
  serverTime: string;
  today: DailyGoalDay;
  history: DailyGoalDay[];
  streak: number;
  bestStreak: number;
  fullDays: number;
  achievements: Array<{ days: number; earned: boolean }>;
};

export function dailyGoalDay(date: string, settings: DailyGoalsSettings, counts: DailyGoalCounts): DailyGoalDay {
  const enabled = dailyGoalKinds.filter((kind) => settings[kind].enabled);
  const completedGoals = enabled.filter((kind) => counts[kind] >= settings[kind].target).length;
  const anyReached = completedGoals > 0;
  const allReached = completedGoals === enabled.length;
  return { date, settings, counts, completedGoals, enabledGoals: enabled.length, anyReached, allReached,
    status: allReached ? "complete" : anyReached ? "partial"
      : dailyGoalKinds.some((kind) => counts[kind] > 0) ? "progress" : "empty" };
}
