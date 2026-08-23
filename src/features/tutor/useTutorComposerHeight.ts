import { useEffect, useState } from "react";

export const tutorComposerMinimumHeight = (isNarrow: boolean) => isNarrow ? 72 : 104;

export function useTutorComposerHeight() {
  const initialNarrow = () => window.matchMedia("(max-width: 720px)").matches;
  const [isNarrow, setIsNarrow] = useState(initialNarrow);
  const [composerHeight, setComposerHeight] = useState(() => tutorComposerMinimumHeight(initialNarrow()));

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => {
      setIsNarrow(media.matches);
      setComposerHeight((height) => media.matches
        ? height === 104 ? 72 : Math.max(72, height)
        : Math.max(104, height));
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return { composerHeight, isNarrow, setComposerHeight };
}
