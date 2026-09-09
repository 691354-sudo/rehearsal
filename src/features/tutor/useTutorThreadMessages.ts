import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/contracts";
import type { HistoryMode, TutorRoute } from "../../lib/appRoute";
import { apiFetch } from "../../shared/api";
import { clearMissingTutorThread } from "./tutorThreadRecovery";

export function useTutorThreadMessages({ route, storageKey, onRoute, onMessages, onError, onLoaded }: {
  route: TutorRoute; storageKey: string;
  onRoute: (route: TutorRoute, mode?: HistoryMode) => void;
  onMessages: (messages: ChatMessage[]) => void; onError: (error: string) => void; onLoaded: () => void;
}) {
  const identity = `${storageKey}:${route.thread}:${route.homework}`;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const callbacks = useRef({ onRoute, onMessages, onError, onLoaded });
  callbacks.current = { onRoute, onMessages, onError, onLoaded };
  useEffect(() => {
    let cancelled = false;
    if (!route.thread) { callbacks.current.onMessages([]); setLoading(false); return; }
    callbacks.current.onMessages([]);
    setLoading(true);
    void apiFetch(`/api/chat/${route.thread}/messages${route.homework ? `?homeworkId=${route.homework}` : ""}`).then(async (response) => {
      if (cancelled) return;
      if (response.status === 404) {
        clearMissingTutorThread(window.localStorage, storageKey, route.thread!);
        callbacks.current.onMessages([]); callbacks.current.onRoute({ ...route, thread: null, review: null, homework: undefined }, "replace");
        return;
      }
      if (!response.ok) throw new Error("Could not load session");
      const data = await response.json() as { homeworkId?: string; messages: Array<Pick<ChatMessage, "role" | "content" | "clientMessageId">> };
      if (cancelled) return;
      if (data.homeworkId && !route.homework) {
        callbacks.current.onRoute({ ...route, homework: data.homeworkId }, "replace"); return;
      }
      callbacks.current.onLoaded();
      callbacks.current.onMessages(data.messages.map((message) => ({ ...message, id: message.clientMessageId || crypto.randomUUID() })));
      window.localStorage.setItem(storageKey, route.thread!); setLoaded(identity);
    }).catch(() => {
      if (!cancelled) callbacks.current.onError("This Tutor session could not be loaded. Start a new chat or choose another session.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [identity]);
  return { loadingThread: loading, threadReady: !route.thread || (loaded === identity && !loading) };
}
