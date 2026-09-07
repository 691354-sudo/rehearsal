import { useEffect, useRef } from "react";
import type { LearningItem } from "../../shared/contracts";
import type { ListenAppearance } from "../../../contracts/learning-pilot";
import { usePilot } from "./PilotProvider";

type ListenRun = { listenSessionId: string; cardIds: string[]; appearances: string[]; index: number; completed: Record<string, ListenAppearance> };
export function useListenAppearances(language: string, items: LearningItem[], restore: (items: LearningItem[], index: number) => void) {
  const pilot = usePilot();
  const key = `rehearsal:${pilot.profileId}:en:listen-run`;
  const run = useRef<ListenRun | null>(null);
  const restored = useRef(false);
  const save = () => {
    try {
      if (run.current) localStorage.setItem(key, JSON.stringify(run.current));
      else localStorage.removeItem(key);
    } catch { /* The completed event still has its own durable outbox and sync state. */ }
  };
  const start = (queue: LearningItem[]) => {
    if (language !== "en") return;
    run.current = { listenSessionId: crypto.randomUUID(), cardIds: queue.map((item) => item.publicId),
      appearances: queue.map(() => crypto.randomUUID()), index: 0, completed: {} }; save();
  };
  const enter = (index: number, queue: LearningItem[], newAppearance: boolean) => {
    if (language !== "en") return undefined;
    if (!run.current || queue.some((item, position) => item.publicId !== run.current?.cardIds[position])
      || queue.length !== run.current.cardIds.length) start(queue);
    const current = run.current!;
    current.index = index;
    if (newAppearance) current.appearances[index] = crypto.randomUUID();
    save();
    return { appearanceId: current.appearances[index], listenSessionId: current.listenSessionId, cardId: queue[index].publicId };
  };
  useEffect(() => {
    if (language !== "en" || restored.current || !items.length) return;
    restored.current = true;
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const saved = JSON.parse(stored) as ListenRun;
      const queue = saved.cardIds.map((id) => items.find((item) => item.publicId === id));
      if (queue.some((item) => !item) || !queue[saved.index]) return;
      run.current = { ...saved, completed: saved.completed ?? {} }; restore(queue as LearningItem[], saved.index);
    } catch { /* An unavailable queue can still be started from current Library. */ }
  }, [language, items, key]);
  return { start, enter, complete: (appearance: NonNullable<ReturnType<typeof enter>>, repetitions: number) => {
    if (!run.current) return;
    const event = run.current.completed[appearance.appearanceId] ?? { ...appearance, language: "en" as const, eventId: appearance.appearanceId,
      completedAt: new Date().toISOString(), audioRepeatsInAppearance: repetitions };
    run.current.completed[appearance.appearanceId] = event; save();
    pilot.complete(event);
  }, clear: () => { run.current = null; save(); } };
}
