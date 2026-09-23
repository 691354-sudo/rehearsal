import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchRecommendationAvailability } from "./useRecommendationRefresh";

describe("recommendation refresh", () => {
  let document: EventTarget & { visibilityState: string }, window: EventTarget;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    window = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    vi.stubGlobal("document", document); vi.stubGlobal("window", window);
  });
  afterEach(() => { stop?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  const availability = { availableCount: 0, waitingCount: 10, nextAvailableAt: "2026-10-01T12:30:00Z", serverTime: "2026-10-01T12:00:00Z" };

  it("refreshes when the server interval ends despite a different device clock", () => {
    const refresh = vi.fn(); stop = watchRecommendationAvailability(availability, refresh);
    vi.advanceTimersByTime(1_799_999); expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2); expect(refresh).toHaveBeenCalledOnce();
  });
  it("refreshes on return or reconnect, coalesces focus events, and cleans up", () => {
    const refresh = vi.fn(); stop = watchRecommendationAvailability(availability, refresh);
    document.visibilityState = "hidden";
    vi.advanceTimersByTime(1_800_001); expect(refresh).not.toHaveBeenCalled();
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online")); vi.advanceTimersByTime(1); expect(refresh).toHaveBeenCalledTimes(2);
    stop(); window.dispatchEvent(new Event("focus")); vi.runAllTimers(); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("does not poll an empty Library with no future availability and cancels pending refreshes", () => {
    const refresh = vi.fn(); stop = watchRecommendationAvailability(null, refresh);
    vi.advanceTimersByTime(86_400_000); expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus")); stop(); vi.runAllTimers(); expect(refresh).not.toHaveBeenCalled();
  });
});
