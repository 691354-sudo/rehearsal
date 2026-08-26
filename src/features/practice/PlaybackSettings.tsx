import { requiresStrictElevenLabs } from "../../../contracts/api";
import { speedRangeForProvider } from "../../lib/playbackSettings";
import type { ElevenLabsConfig, Language, PlaybackPreferences } from "../../shared/contracts";

export const voiceDisplayName = (name: string) => name.split(/\s+-\s+/, 1)[0]?.trim() || name;

export function PlaybackSettings(props: {
  elevenLabs: ElevenLabsConfig;
  language: Language;
  onPlayback: (playback: PlaybackPreferences) => void;
  playback: PlaybackPreferences;
  voices: string[];
}) {
  const speedRange = speedRangeForProvider(props.playback.provider, props.elevenLabs.speedRange);
  const compatibleElevenLabsVoices = props.elevenLabs.voicesByLanguage[props.language] || [];
  const selectedElevenLabsVoice = compatibleElevenLabsVoices.find(
    (voice) => voice.id === props.playback.elevenlabs.voiceId,
  ) || compatibleElevenLabsVoices[0] || { id: "", name: "No compatible voice" };

  return <div className="practice-playback-settings">
    <label><span>Voice</span><select aria-label="Voice" name="practice-voice" onChange={(event) => {
      const [providerValue, voice] = event.target.value.split(":");
      const provider = providerValue as PlaybackPreferences["provider"];
      props.onPlayback(provider === "elevenlabs" ? {
        ...props.playback,
        provider,
        elevenlabs: { ...props.playback.elevenlabs, voiceId: voice },
      } : { ...props.playback, provider, voice });
    }} value={props.playback.provider === "elevenlabs"
      ? `elevenlabs:${selectedElevenLabsVoice.id}` : `openai:${props.playback.voice}`}>
      {!requiresStrictElevenLabs(props.language) ? props.voices.map((voice) => <option key={voice} value={`openai:${voice}`}>OpenAI · {voice}</option>) : null}
      {!compatibleElevenLabsVoices.length ? <option value="elevenlabs:" disabled>No compatible voice configured</option> : null}
      {compatibleElevenLabsVoices.map((voice) =>
        <option key={voice.id} value={`elevenlabs:${voice.id}`}>ElevenLabs · {voiceDisplayName(voice.name)}</option>)}
    </select></label>
    <label><span>Speed · {props.playback.speed.toFixed(2)}×</span><input aria-label="Speed" max={speedRange.max} min={speedRange.min} name="practice-speed"
      onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })} step="0.05" type="range" value={props.playback.speed} /></label>
    <label><span>Repeats</span><select name="practice-repetitions" onChange={(event) => props.onPlayback({ ...props.playback, repetitions: Number(event.target.value) })} value={props.playback.repetitions}>
      {[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
    <div className="practice-adaptive-pause"><span>Pause</span><strong>Adaptive · audio length + 0.5s</strong></div>
  </div>;
}
