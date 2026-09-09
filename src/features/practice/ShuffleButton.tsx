import { Shuffle } from "lucide-react";

export function ShuffleButton({ enabled, onClick, size }: { enabled: boolean; onClick: () => void; size: number }) {
  return <button aria-label="Shuffle" aria-pressed={enabled} className={`listen-shuffle${enabled ? " is-active" : ""}`}
    onClick={onClick} title={enabled ? "Shuffle on · Turn off" : "Shuffle off · Turn on"} type="button">
    <Shuffle aria-hidden="true" size={size} />
    {enabled ? <span aria-hidden="true" className="listen-shuffle-dot" /> : null}
  </button>;
}
