import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Homework, ListenAppearance, PilotSettings, PriorityRequest } from "../../../contracts/learning-pilot";
import { PilotOutbox, type PendingPilotEvent } from "./outbox";
import { browserTimezone, pilotErrorMessage, pilotRequest } from "./pilotApi";

type CardProgress = { listenCount: number; liked: boolean; recallEligibleAt: string | null };
type PilotContextValue = {
  profileId: string; settings: PilotSettings | null; pendingCount: number; syncError: string;
  progress: Record<string, Partial<CardProgress>>;
  pendingRequests: PriorityRequest[];
  complete: (event: ListenAppearance) => void;
  like: (cardId: string, liked: boolean) => void;
  refreshCard: (cardId: string) => void;
  refresh: () => Promise<void>;
  retry: () => void;
};
const PilotContext = createContext<PilotContextValue | null>(null);
export const usePilot = () => {
  const context = useContext(PilotContext);
  if (!context) throw new Error("Pilot provider is missing");
  return context;
};

export function PilotProvider({ profileId, language, children, onChange }: {
  profileId: string; language: string; children: ReactNode;
  onChange: (cardId: string, patch: Partial<CardProgress>) => void;
}) {
  const [settings, setSettings] = useState<PilotSettings | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PriorityRequest[]>([]);
  const [progress, setProgress] = useState<Record<string, Partial<CardProgress>>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState("");
  const outbox = useRef<PilotOutbox | null>(null);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const identityRef = useRef(profileId); identityRef.current = profileId;
  const refresh = async () => {
    if (language !== "en") return;
    const response = await pilotRequest<{ settings: PilotSettings; pending: PriorityRequest[]; homework: Homework | null }>(
      profileId, `?language=en&timezone=${encodeURIComponent(browserTimezone())}`);
    if (identityRef.current !== profileId) return;
    setSettings(response.settings); setPendingRequests(response.pending);
  };
  const merge = (cardId: string, patch: Partial<CardProgress>) => {
    setProgress((previous) => ({ ...previous, [cardId]: { ...previous[cardId], ...patch } }));
    changeRef.current(cardId, patch);
  };
  const applyPending = (events: PendingPilotEvent[]) => {
    setPendingCount(events.length);
    for (const event of events) if (event.path === "/likes") merge(event.body.cardId, { liked: event.body.liked });
  };
  useEffect(() => {
    setProgress({}); setSyncError(""); setPendingCount(0); setSettings(null); setPendingRequests([]);
    if (language !== "en") return;
    const queue = new PilotOutbox(localStorage, `rehearsal:${profileId}:en:pilot-outbox`,
      (event) => pilotRequest(profileId, event.path, event.body),
      () => { const events = queue.pending(); if (!events.length) setSyncError(""); applyPending(events); },
      (error) => setSyncError(pilotErrorMessage(error)),
      (event, response) => {
        if (event.path === "/listens") merge(event.body.cardId, response as CardProgress);
        else {
          const result = response as { liked: boolean; pending: PriorityRequest[] };
          merge(event.body.cardId, { liked: result.liked }); setPendingRequests(result.pending);
        }
      });
    outbox.current = queue;
    try { applyPending(queue.pending()); } catch { setSyncError("Could not read saved progress on this device."); }
    void refresh().catch(() => undefined);
    const retry = () => { void queue.flush(); void refresh().catch(() => undefined); };
    window.addEventListener("online", retry); window.addEventListener("storage", retry);
    void queue.flush();
    return () => { queue.stop(); outbox.current = null; window.removeEventListener("online", retry); window.removeEventListener("storage", retry); };
  }, [profileId, language]);
  const complete = (event: ListenAppearance) => outbox.current?.enqueue({ path: "/listens", body: event });
  const like = (cardId: string, liked: boolean) => {
    outbox.current?.enqueue({ path: "/likes", body: { eventId: crypto.randomUUID(), language: "en", cardId, liked, occurredAt: new Date().toISOString() } });
    merge(cardId, { liked });
  };
  const refreshCard = (cardId: string) => {
    void pilotRequest<CardProgress>(profileId, `/cards/${encodeURIComponent(cardId)}?language=en`).then((value) => {
      if (identityRef.current !== profileId) return;
      merge(cardId, value);
      if (outbox.current) applyPending(outbox.current.pending());
    }).catch(() => undefined);
  };
  return <PilotContext.Provider value={{ profileId, settings, pendingRequests, pendingCount, progress, syncError,
    complete, like, refreshCard, refresh, retry: () => { void outbox.current?.flush(); } }}>{children}</PilotContext.Provider>;
}
