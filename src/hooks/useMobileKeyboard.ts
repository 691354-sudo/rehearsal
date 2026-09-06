import { useEffect, useState } from "react";

export function isKeyboardViewport(baseline: number, visible: number, scale: number) {
  // Browser chrome changes are much smaller; pinch zoom is not a keyboard.
  return scale <= 1.05 && baseline - visible > 120;
}

export function useMobileKeyboard() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const media = window.matchMedia("(max-width: 720px)");
    if (!viewport) return;
    let baseline = Math.max(window.innerHeight, viewport.height);
    let width = window.innerWidth;
    let keyboard = false;
    const update = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement
        && !["button", "checkbox", "radio", "range", "file", "submit"].includes(active.type));
      if (width !== window.innerWidth) { width = window.innerWidth; baseline = window.innerHeight; }
      if (!editing && !keyboard) baseline = Math.max(window.innerHeight, viewport.height);
      keyboard = media.matches && (editing || keyboard)
        && isKeyboardViewport(baseline, viewport.height, viewport.scale);
      document.documentElement.style.setProperty("--echo-visual-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--echo-visual-top", `${viewport.offsetTop}px`);
      setOpen(keyboard);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
      document.documentElement.style.removeProperty("--echo-visual-height");
      document.documentElement.style.removeProperty("--echo-visual-top");
    };
  }, []);
  return open;
}
