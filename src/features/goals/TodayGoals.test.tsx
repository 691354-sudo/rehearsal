import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoalsSync } from "./TodayGoals";

const goals = vi.hoisted(() => ({ error: "", syncError: "", refresh: vi.fn(), retrySync: vi.fn() }));
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
