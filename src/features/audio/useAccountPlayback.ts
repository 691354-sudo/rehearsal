import { useEffect, useRef } from "react";
import type { Language, PlaybackPreferences } from "../../shared/contracts";
import { apiFetch } from "../../shared/api";
import { mergePlayback, type PlaybackPatch } from "../../../contracts/playback-preferences";

export function useAccountPlayback(language: Language, localValue: string | null, playback: PlaybackPreferences,
  onLoaded: (preferences: PlaybackPreferences) => void, onError: (message: string) => void) {
  const callbacks = useRef({ onLoaded, onError }); callbacks.current = { onLoaded, onError };
  const pending = useRef<Partial<Record<Language, PlaybackPatch>>>({});
  const revisions = useRef<Partial<Record<Language, number>>>({});
  const loads = useRef<Partial<Record<Language, Promise<void>>>>({});
  const saves = useRef(Promise.resolve());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await apiFetch(`/api/settings/playback?language=${language}`);
      if (!response.ok) throw new Error();
      let { playback: saved } = await response.json() as { playback: PlaybackPreferences | null };
      if (!saved && localValue) {
        const imported = await apiFetch("/api/settings/playback", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, playback }) });
        if (!imported.ok) throw new Error();
        saved = (await imported.json()).playback;
      }
      if (saved && !cancelled) callbacks.current.onLoaded(mergePlayback(saved, pending.current[language] || {}));
    };
    loads.current[language] = load().catch(() => {
      if (!cancelled) callbacks.current.onError("Account audio settings could not be loaded. Reopen this page to retry.");
    });
    return () => { cancelled = true; };
  }, [language]);
  return (next: PlaybackPreferences) => {
    const patch: PlaybackPatch = {};
    for (const field of ["provider", "repetitions", "speed", "playAfterRecall", "voice"] as const) {
      if (JSON.stringify(next[field]) !== JSON.stringify(playback[field])) Object.assign(patch, { [field]: next[field] });
    }
    for (const field of ["voiceId", "modelId"] as const) {
      if (next.elevenlabs[field] !== playback.elevenlabs[field]) patch.elevenlabs = { ...patch.elevenlabs, [field]: next.elevenlabs[field] };
    }
    if (!Object.keys(patch).length) return;
    const previous = pending.current[language];
    pending.current[language] = { ...previous, ...patch, ...(patch.elevenlabs ? { elevenlabs: { ...previous?.elevenlabs, ...patch.elevenlabs } } : {}) };
    const revision = revisions.current[language] = (revisions.current[language] || 0) + 1;
    saves.current = saves.current.then(async () => {
      await loads.current[language];
      if (!active.current) return;
      const init = { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language, playback: next }) };
      // Import is insert-only: another device's values remain authoritative.
      const initialized = await apiFetch("/api/settings/playback", { ...init, method: "POST" });
      if (!initialized.ok) throw new Error();
      const response = await apiFetch("/api/settings/playback", { ...init, method: "PATCH", body: JSON.stringify({ language, playback: patch }) });
      if (!response.ok) throw new Error();
      if (revisions.current[language] === revision) delete pending.current[language];
    }).catch(() => { if (active.current) callbacks.current.onError("Audio settings have not synced to your account. Change the setting again to retry."); });
  };
}
