import { useEffect, useLayoutEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

export const tutorComposerMinimumHeight = 64;

export function useTutorComposerHeight(fieldRef: RefObject<HTMLTextAreaElement | null>, draft: string, visible: boolean) {
  const initialNarrow = () => window.matchMedia("(max-width: 720px)").matches;
  const [isNarrow, setIsNarrow] = useState(initialNarrow);
  const [composerHeight, setHeight] = useState(tutorComposerMinimumHeight);
  const clampHeight = (height: number) => Math.max(tutorComposerMinimumHeight,
    Math.min(height, isNarrow ? 240 : 400, (window.visualViewport?.height || window.innerHeight) * .4));
  const setComposerHeight: Dispatch<SetStateAction<number>> = (value) => {
    setHeight((height) => clampHeight(typeof value === "function" ? value(height) : value));
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!visible || !field) return;
    const fit = () => {
      const style = window.getComputedStyle(field);
      field.style.height = "auto";
      const height = clampHeight(field.scrollHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth));
      field.style.height = `${height}px`;
      setHeight(height);
    };
    fit();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      fit();
    });
    observer.observe(field);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [draft, isNarrow, visible, fieldRef]);

  return { composerHeight, isNarrow, setComposerHeight };
}
