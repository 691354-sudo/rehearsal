import type { PlaybackPreferences } from "../../shared/contracts";

export function RepetitionsButton({ playback, onPlayback }: {
  playback: PlaybackPreferences;
  onPlayback: (playback: PlaybackPreferences) => void;
}) {
  const next = playback.repetitions === 1 ? 2 : 1;
  return <button aria-label={`Repetitions: ${playback.repetitions}. Switch to ${next}.`} className="listen-repetitions"
    onClick={() => onPlayback({ ...playback, repetitions: next })} title={`Repeats per card: ${playback.repetitions}×. Switch to ${next}×.`} type="button">
    {playback.repetitions}×
  </button>;
}
