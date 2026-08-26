import { useEffect, useRef, useState } from "react";
import { registerSW } from "virtual:pwa-register";
import { isTelegramMiniApp } from "../lib/telegramMiniApp";

export function PwaUpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const updateRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (isTelegramMiniApp()) return;
    updateRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setAvailable(true),
    });
  }, []);

  if (!available) return null;
  return <aside aria-live="polite" className="simple-update-prompt">
    <span>Update ready</span>
    <button onClick={() => { setAvailable(false); void updateRef.current?.(true); }} type="button">Reload</button>
    <button aria-label="Dismiss update" onClick={() => setAvailable(false)} type="button">Later</button>
  </aside>;
}
