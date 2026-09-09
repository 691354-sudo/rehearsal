import { useEffect, useState } from "react";

export const tutorComposerMinimumHeight = 64;

export function useTutorComposerHeight() {
  const initialNarrow = () => window.matchMedia("(max-width: 720px)").matches;
  const [isNarrow, setIsNarrow] = useState(initialNarrow);
  const [composerHeight, setComposerHeight] = useState(tutorComposerMinimumHeight);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => {
      setIsNarrow(media.matches);
      setComposerHeight((height) => Math.max(tutorComposerMinimumHeight, height));
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return { composerHeight, isNarrow, setComposerHeight };
}
