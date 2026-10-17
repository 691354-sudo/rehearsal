import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsSync, RecallGoalProgress, TodayGoals } from "./TodayGoals";
import { dailyGoalDay, defaultDailyGoals, type DailyGoalsSnapshot } from "../../../contracts/daily-goals";

const goals = vi.hoisted(() => ({ data: null as DailyGoalsSnapshot | null, error: "", syncError: "", celebrating: false,
  open: vi.fn(), refresh: vi.fn(), retrySync: vi.fn() }));
vi.mock("./GoalsProvider", () => ({ useGoals: () => goals }));

describe("Daily goals synchronization notices", () => {
  beforeEach(() => { goals.error = ""; goals.syncError = ""; });

  it("stays silent during ordinary synchronization", () => {
    expect(renderToStaticMarkup(<GoalsSync />)).toBe("");
  });

  it("keeps failed progress synchronization visible with Retry", () => {
    goals.syncError = "Could not save progress. Try again.";
    const markup = renderToStaticMarkup(<GoalsSync />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(goals.syncError);
    expect(markup).toContain(">Retry</button>");
    expect(markup).not.toContain("awaiting sync");
  });

  it("keeps daily goal refresh failures visible with Retry", () => {
    goals.error = "Couldn’t sync daily goals. Try again.";
    const markup = renderToStaticMarkup(<GoalsSync />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(goals.error);
    expect(markup).toContain(">Retry</button>");
  });
});

describe("active Recall daily goal", () => {
  beforeEach(() => { goals.error = ""; goals.syncError = ""; });
  it.each([0, 11, 20, 23])("shows the checked-answer count %s beside the Recall controls", (count) => {
      goals.data = { startedAt: "2026-10-17T00:00:00Z", today: dailyGoalDay("2026-10-17", defaultDailyGoals,
        { listen: 0, recall: count, tutor: 0 }) } as DailyGoalsSnapshot;
      const markup = renderToStaticMarkup(<RecallGoalProgress />);
      expect(markup).toContain(`${count}/20`);
      expect(markup).toContain(`Daily Recall goal: ${count} of 20 correct answers`);
      expect(renderToStaticMarkup(<TodayGoals active kind="recall" />)).toBe("");
    });

  it("hides the indicator for a disabled Recall goal and preserves the compact Listen goal", () => {
    goals.data = { startedAt: "2026-10-17T00:00:00Z", today: dailyGoalDay("2026-10-17",
      { ...defaultDailyGoals, recall: { enabled: false, target: 20 } }, { listen: 0, recall: 0, tutor: 0 }) } as DailyGoalsSnapshot;
    expect(renderToStaticMarkup(<RecallGoalProgress />)).toBe("");
    expect(renderToStaticMarkup(<TodayGoals active kind="listen" />)).toContain("Today · Listen");
  });
});
