import { speedRangeForProvider } from "../../lib/playbackSettings";
import type { ElevenLabsConfig, Language, PlaybackPreferences } from "../../shared/contracts";

export function PlaybackSettings(props: {
  elevenLabs: ElevenLabsConfig;
  language: Language;
  onPlayback: (playback: PlaybackPreferences) => void;
  playback: PlaybackPreferences;
  voices: string[];
}) {
  const speedRange = speedRangeForProvider(props.playback.provider, props.elevenLabs.speedRange);
  const selectedElevenLabsVoice = props.elevenLabs.voices.find(
    (voice) => voice.id === props.playback.elevenlabs.voiceId,
  ) || props.elevenLabs.voice;

  return <div className="practice-playback-settings">
    <label><span>Voice</span><select aria-label="Voice" onChange={(event) => {
      const [providerValue, voice] = event.target.value.split(":");
      const provider = providerValue as PlaybackPreferences["provider"];
      props.onPlayback(provider === "elevenlabs" ? {
        ...props.playback,
        provider,
        elevenlabs: { ...props.playback.elevenlabs, voiceId: voice },
      } : { ...props.playback, provider, voice });
    }} value={props.playback.provider === "elevenlabs"
      ? `elevenlabs:${selectedElevenLabsVoice.id}` : `openai:${props.playback.voice}`}>
      {props.voices.map((voice) => <option key={voice} value={`openai:${voice}`}>OpenAI · {voice}</option>)}
      {props.elevenLabs.configured && props.language === "en" ? props.elevenLabs.voices.map((voice) =>
        <option key={voice.id} value={`elevenlabs:${voice.id}`}>ElevenLabs · {voice.name}</option>) : null}
    </select></label>
    <label><span>Speed · {props.playback.speed.toFixed(2)}×</span><input aria-label="Speed" max={speedRange.max} min={speedRange.min}
      onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })} step="0.05" type="range" value={props.playback.speed} /></label>
    <label><span>Repeats</span><select onChange={(event) => props.onPlayback({ ...props.playback, repetitions: Number(event.target.value) })} value={props.playback.repetitions}>
      {[1, 2, 3, 5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
    <label><span>Pause</span><select onChange={(event) => props.onPlayback({ ...props.playback, pauseMs: Number(event.target.value) })} value={props.playback.pauseMs}>
      {[500, 1500, 3000].map((value) => <option key={value} value={value}>{value / 1000}s</option>)}</select></label>
  </div>;
}
