import { useEffect } from "react";

export const shouldPauseForTelegram = (phase: "setup" | "player" | "complete", status: "playing" | "paused" | "error") =>
  phase === "player" && status === "playing";

export function useTelegramPlaybackPause(
  phase: "setup" | "player" | "complete",
  status: "playing" | "paused" | "error",
  pause: () => void,
) {
  useEffect(() => {
    const onDeactivated = () => {
      if (shouldPauseForTelegram(phase, status)) pause();
    };
    window.addEventListener("telegram-deactivated", onDeactivated);
    return () => window.removeEventListener("telegram-deactivated", onDeactivated);
  }, [pause, phase, status]);
}
