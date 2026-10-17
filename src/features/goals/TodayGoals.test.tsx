import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsSync, TodayGoals } from "./TodayGoals";
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
  it.each([[13, "7 correct answers left"], [19, "1 correct answer left"], [20, "Recall goal complete"], [23, "Recall goal complete"]])(
    "shows remaining checked answers for a count of %s", (count, expected) => {
      goals.data = { startedAt: "2026-10-17T00:00:00Z", today: dailyGoalDay("2026-10-17", defaultDailyGoals,
        { listen: 0, recall: count, tutor: 0 }) } as DailyGoalsSnapshot;
      const markup = renderToStaticMarkup(<TodayGoals active kind="recall" />);
      expect(markup).toContain(expected);
      expect(markup).toContain(`${count} / 20`);
      expect(markup).not.toContain("-3");
    });

  it("does not show a remaining target for a disabled Recall goal or while listening", () => {
    goals.data = { startedAt: "2026-10-17T00:00:00Z", today: dailyGoalDay("2026-10-17",
      { ...defaultDailyGoals, recall: { enabled: false, target: 20 } }, { listen: 0, recall: 0, tutor: 0 }) } as DailyGoalsSnapshot;
    expect(renderToStaticMarkup(<TodayGoals active kind="recall" />)).toContain("goal off");
    expect(renderToStaticMarkup(<TodayGoals active kind="recall" />)).not.toContain("goals-remaining");
    expect(renderToStaticMarkup(<TodayGoals active kind="listen" />)).not.toContain("goals-remaining");
  });
});
