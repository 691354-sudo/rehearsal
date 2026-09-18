import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Homework, ListenAppearance, PilotSettings, PriorityRequest } from "../../../contracts/learning-pilot";
import { PilotOutbox, type PendingPilotEvent } from "./outbox";
import { browserTimezone, pilotErrorMessage, pilotRequest } from "./pilotApi";

type CardProgress = { learningStage: "listen" | "recall" | "tutor"; listenTarget:number; listenCount: number; liked: boolean; recallEligibleAt: string | null };
type PilotContextValue = {
  profileId: string; language: import("../../../contracts/api").LanguageCode; readyCount:number; revision:number; recallPendingIds:string[]; toRecall:(cardId:string)=>void; settings: PilotSettings | null; pendingCount: number; syncError: string;
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
  profileId: string; language: import("../../../contracts/api").LanguageCode; children: ReactNode;
  onChange: (cardId: string, patch: Partial<CardProgress>) => void;
}) {
  const [recallPendingIds, setRecallPendingIds] = useState<string[]>([]);
  const [revision,setRevision]=useState(0);
  const [readyCount,setReadyCount]=useState(0);
  const [settings, setSettings] = useState<PilotSettings | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PriorityRequest[]>([]);
  const [progress, setProgress] = useState<Record<string, Partial<CardProgress>>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState("");
  const outbox = useRef<PilotOutbox | null>(null);
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const identity = `${profileId}:${language}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const refresh = async () => {
    const response = await pilotRequest<{ settings: PilotSettings; pending: PriorityRequest[]; homework: Homework | null; readyCount:number }>(
      profileId, `?language=${language}&timezone=${encodeURIComponent(browserTimezone())}`);
    if (identityRef.current !== identity) return;
    setReadyCount(response.readyCount);setSettings(response.settings); setPendingRequests(response.pending);
  };
  const merge = (cardId: string, patch: Partial<CardProgress>) => {
    setProgress((previous) => ({ ...previous, [cardId]: { ...previous[cardId], ...patch } }));
    changeRef.current(cardId, patch);
  };
  const applyPending = (events: PendingPilotEvent[]) => {
    setPendingCount(events.length);
    setRecallPendingIds(events.filter((event) => event.path === "/to-recall").map((event) => event.body.cardId));
    for (const event of events) if (event.path === "/likes") merge(event.body.cardId, { liked: event.body.liked });
  };
  useEffect(() => {
    setRecallPendingIds([]); setReadyCount(0); setProgress({}); setSyncError(""); setPendingCount(0); setSettings(null); setPendingRequests([]);
    const queue = new PilotOutbox(localStorage, `rehearsal:${profileId}:${language}:pilot-outbox`,
      (event) => pilotRequest(profileId, event.path, event.body),
      () => { const events = queue.pending(); if (!events.length) setSyncError(""); applyPending(events); },
      (error) => setSyncError(pilotErrorMessage(error)),
      (event, response) => {
        if (identityRef.current !== identity) return;
        setRevision((value)=>value+1);
        if (event.path === "/listens" || event.path === "/to-recall") merge(event.body.cardId, response as CardProgress);
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
    outbox.current?.enqueue({ path: "/likes", body: { eventId: crypto.randomUUID(), language, cardId, liked, occurredAt: new Date().toISOString() } });
    merge(cardId, { liked });
  };
  const toRecall = (cardId: string) => {
    if (outbox.current?.pending().some((event) => event.path === "/to-recall" && event.body.cardId === cardId)) return;
    outbox.current?.enqueue({ path: "/to-recall", body: { eventId: crypto.randomUUID(), cardId, language } });
  };
  const refreshCard = (cardId: string) => {
    void pilotRequest<CardProgress>(profileId, `/cards/${encodeURIComponent(cardId)}?language=${language}`).then((value) => {
      if (identityRef.current !== identity) return;
      merge(cardId, value);
      if (outbox.current) applyPending(outbox.current.pending());
    }).catch(() => undefined);
  };
  return <PilotContext.Provider value={{ profileId, language, readyCount,revision,recallPendingIds,toRecall, settings, pendingRequests, pendingCount, progress, syncError,
    complete, like, refreshCard, refresh, retry: () => { void outbox.current?.flush(); } }}>{children}</PilotContext.Provider>;
}
