import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { DailyGoalKind, DailyGoalsSettings, DailyGoalsSnapshot } from "../../../contracts/daily-goals";
import { apiFetch } from "../../shared/api";
import { usePilot } from "../pilot/PilotProvider";
import type { AppRoute } from "../../lib/appRoute";

type GoalsContextValue = {
  data: DailyGoalsSnapshot | null; error: string; pending: number; syncError: string; celebrating: boolean;
  open: () => void; goalRoute: (kind: DailyGoalKind) => AppRoute | null;
  refresh: () => Promise<void>; save: (settings: DailyGoalsSettings, start: boolean) => Promise<void>;
};
const GoalsContext = createContext<GoalsContextValue | null>(null);
export const useGoals = () => {
  const context = useContext(GoalsContext);
  if (!context) throw new Error("Goals provider is missing");
  return context;
};

function pendingListens(profileId: string) {
  let count = 0;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(`rehearsal:${profileId}:`) || !key.includes(":pilot-outbox:")) continue;
    try { if (JSON.parse(localStorage.getItem(key) || "null")?.event?.path === "/listens") count++; }
    catch { /* The outbox owns recovery of unreadable events. */ }
  }
  return count;
}

export function GoalsProvider({ profileId, open, goalRoute, children }: {
  profileId: string; open: () => void; goalRoute: (kind: DailyGoalKind) => AppRoute | null; children: ReactNode;
}) {
  const pilot = usePilot();
  const [data, setData] = useState<DailyGoalsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const latest = useRef(data); latest.current = data;
  const sequence = useRef(0);
  const mounted = useRef(true);
  const accept = useCallback((next: DailyGoalsSnapshot) => {
    if (latest.current?.startedAt && latest.current.today.date === next.today.date
      && !latest.current.today.allReached && next.today.allReached) setCelebrating(true);
    latest.current = next; setData(next); setError("");
  }, []);
  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await apiFetch(path, { ...init, headers: {
      "Content-Type": "application/json", "X-Rehearsal-Profile": profileId,
    } });
    if (!response.ok) throw new Error(response.status === 409
      ? "Your profile changed. Reload the app to continue." : "Couldn’t sync daily goals. Try again.");
    return await response.json() as DailyGoalsSnapshot;
  }, [profileId]);
  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const next = await request("/api/goals");
      if (mounted.current && current === sequence.current) accept(next);
    } catch (caught) {
      if (mounted.current && current === sequence.current) setError((caught as Error).message);
    }
  }, [request, accept]);
  const save = async (settings: DailyGoalsSettings, start: boolean) => {
    ++sequence.current;
    const next = await request(start ? "/api/goals/start" : "/api/goals/settings", {
      method: start ? "POST" : "PATCH", body: JSON.stringify({ settings }),
    });
    if (mounted.current) { ++sequence.current; accept(next); }
    localStorage.setItem(`rehearsal:${profileId}:goals-updated`, String(Date.now()));
  };
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      setPending(pendingListens(profileId));
      clearTimeout(timer); timer = setTimeout(() => void refresh(), 100);
    };
    const activity = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; profileId: string | null }>).detail;
      if (detail.profileId && detail.profileId !== profileId) return;
      if (!["/api/pilot/listens", "/api/pilot/attempts/check", "/api/chat"].includes(detail.path)) return;
      update();
      localStorage.setItem(`rehearsal:${profileId}:goals-updated`, String(Date.now()));
    };
    const visible = () => { if (!document.hidden) update(); };
    update();
    window.addEventListener("rehearsal:activity-saved", activity);
    window.addEventListener("focus", update); window.addEventListener("online", update);
    window.addEventListener("telegram-activated", update);
    window.addEventListener("storage", update); document.addEventListener("visibilitychange", visible);
    const midnight = setInterval(visible, 60_000);
    return () => {
      mounted.current = false; ++sequence.current; clearTimeout(timer); clearInterval(midnight);
      window.removeEventListener("rehearsal:activity-saved", activity);
      window.removeEventListener("focus", update); window.removeEventListener("online", update);
      window.removeEventListener("telegram-activated", update);
      window.removeEventListener("storage", update); document.removeEventListener("visibilitychange", visible);
    };
  }, [profileId, refresh]);
  useEffect(() => { setPending(pendingListens(profileId)); }, [profileId, pilot.pendingCount]);
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(() => setCelebrating(false), 2400);
    return () => clearTimeout(timer);
  }, [celebrating]);
  return <GoalsContext.Provider value={{ data, error, pending, syncError: pilot.syncError, celebrating,
    open, goalRoute, refresh, save }}>{children}</GoalsContext.Provider>;
}
