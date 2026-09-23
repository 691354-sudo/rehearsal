import { useEffect, useRef } from "react";
import type { RecommendationAvailability } from "../../../contracts/learning-pilot";

export function watchRecommendationAvailability(availability: RecommendationAvailability | null, refresh: () => void) {
  let pending: number | undefined;
  const request = () => {
    if (document.visibilityState === "hidden" || pending !== undefined) return;
    pending = window.setTimeout(() => { pending = undefined; refresh(); }, 0);
  };
  // Use the server's interval, so an incorrect device clock cannot empty the queue.
  const delay = availability?.nextAvailableAt
    ? Date.parse(availability.nextAvailableAt) - Date.parse(availability.serverTime) : null;
  const timer = delay === null ? undefined : window.setTimeout(request, Math.max(0, Math.min(delay, 2_147_483_647)));
  window.addEventListener("focus", request);
  window.addEventListener("online", request);
  document.addEventListener("visibilitychange", request);
  return () => {
    window.clearTimeout(timer); window.clearTimeout(pending);
    window.removeEventListener("focus", request);
    window.removeEventListener("online", request);
    document.removeEventListener("visibilitychange", request);
  };
}

export function useRecommendationRefresh(availability: RecommendationAvailability | null, enabled: boolean, refresh: () => void) {
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    if (enabled) return watchRecommendationAvailability(availability, () => refreshRef.current());
  }, [availability, enabled]);
}
