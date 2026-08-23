import { Repeat1, Repeat2 } from "lucide-react";
import type { RepeatMode } from "../audio/listenAudio";

const labels: Record<RepeatMode, string> = {
  off: "Repeat off",
  all: "Repeat all cards",
  one: "Repeat one card",
};

export function RepeatModeButton({ mode, onClick, size }: {
  mode: RepeatMode;
  onClick: () => void;
  size: number;
}) {
  const label = labels[mode];
  return <button aria-label={label} aria-pressed={mode !== "off"} className={mode !== "off" ? "is-active" : ""}
    onClick={onClick} title={label} type="button">{mode === "one" ? <Repeat1 aria-hidden="true" size={size} /> : <Repeat2 aria-hidden="true" size={size} />}</button>;
}
