import { useEffect, useRef } from "react";

export function usePlaybackSettingsReveal(shown: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!shown) return;
    const frame = window.requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shown]);
  return ref;
}
