import { useEffect, useState } from "react";
import { LoaderCircle, Play, RefreshCw, X } from "lucide-react";
import { speedRangeForProvider } from "../../lib/playbackSettings";
import { apiFetch } from "../../shared/api";
import { capitalize, humanizeLabel } from "../../shared/config";
import type {
  ElevenLabsConfig,
  ElevenLabsPreferences,
  ElevenLabsVoiceStatus,
  ItemPreference,
  PlaybackPreferences,
  PlaybackResult,
  SchedulerSettings,
  TtsProvider,
} from "../../shared/contracts";

export function GlobalSettings(props: {
  elevenLabs: ElevenLabsConfig;
  onClose: () => void;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPreview: () => Promise<PlaybackResult>;
  onSaveScheduler: (settings: SchedulerSettings) => Promise<void>;
  playback: PlaybackPreferences;
  scheduler: SchedulerSettings;
  voices: string[];
}) {
  const [draft, setDraft] = useState(props.scheduler);
  const [learningSteps, setLearningSteps] = useState(props.scheduler.learningSteps.join(", "));
  const [relearningSteps, setRelearningSteps] = useState(props.scheduler.relearningSteps.join(", "));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [previewState, setPreviewState] = useState<"idle" | "playing" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<ElevenLabsVoiceStatus | null>(null);
  const [voiceStatusState, setVoiceStatusState] = useState<"idle" | "checking" | "ready" | "error">("idle");

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props.onClose]);

  useEffect(() => {
    if (!props.elevenLabs.configured) return;
    const controller = new AbortController();
    setVoiceStatusState("checking");
    void apiFetch("/api/audio/elevenlabs/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Voice check failed");
        const status = await response.json() as ElevenLabsVoiceStatus;
        if (controller.signal.aborted) return;
        setVoiceStatus(status);
        setVoiceStatusState(status.reachable ? "ready" : "error");
      })
      .catch(() => { if (!controller.signal.aborted) setVoiceStatusState("error"); });
    return () => controller.abort();
  }, [props.elevenLabs.configured]);

  const parseSteps = (value: string) => value.split(/[\s,]+/).map((step) => step.trim()).filter(Boolean);
  const stepPattern = /^\d+(?:\.\d+)?[mhd]$/;
  const nextLearningSteps = parseSteps(learningSteps);
  const nextRelearningSteps = parseSteps(relearningSteps);
  const validSteps = [nextLearningSteps, nextRelearningSteps]
    .every((steps) => steps.length > 0 && steps.length <= 4 && steps.every((step) => stepPattern.test(step)));

  const save = async () => {
    if (!validSteps || saveState === "saving") return;
    setSaveState("saving");
    try {
      await props.onSaveScheduler({
        ...draft,
        learningSteps: nextLearningSteps,
        relearningSteps: nextRelearningSteps,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const updatePreset = (
    preference: ItemPreference,
    field: "requestRetention" | "maximumInterval",
    value: number,
  ) => {
    setSaveState("idle");
    setDraft((current) => ({
      ...current,
      presets: {
        ...current.presets,
        [preference]: { ...current.presets[preference], [field]: value },
      },
    }));
  };

  const updateElevenLabs = <Key extends keyof ElevenLabsPreferences>(
    key: Key,
    value: ElevenLabsPreferences[Key],
  ) => {
    setPreviewNotice("");
    props.onPlayback({
      ...props.playback,
      elevenlabs: { ...props.playback.elevenlabs, [key]: value },
    });
  };

  const refreshVoiceStatus = async () => {
    setVoiceStatusState("checking");
    try {
      const response = await apiFetch("/api/audio/elevenlabs/status?refresh=true");
      if (!response.ok) throw new Error("Voice check failed");
      const status = await response.json() as ElevenLabsVoiceStatus;
      setVoiceStatus(status);
      setVoiceStatusState(status.reachable ? "ready" : "error");
    } catch {
      setVoiceStatusState("error");
    }
  };

  const preview = async () => {
    setPreviewState("playing");
    setPreviewError("");
    setPreviewNotice("");
    try {
      const result = await props.onPreview();
      if (result.provider === "elevenlabs") {
        setPreviewNotice(result.cache === "HIT"
          ? "Played from the server cache · no ElevenLabs credits used"
          : "Generated once · this exact audio is now cached on the server");
      }
      setPreviewState("idle");
    } catch (error) {
      setPreviewState("error");
      setPreviewError(error instanceof Error ? error.message : "Voice preview failed");
    }
  };

  const activeVoice = voiceStatus?.reachable ? voiceStatus.voice : {
    ...props.elevenLabs.voice,
    category: "",
    description: "",
    labels: {} as Record<string, string>,
  };
  const voiceDetails = [activeVoice.labels.accent, activeVoice.labels.use_case, activeVoice.labels.gender]
    .filter(Boolean).map(humanizeLabel).join(" · ") || "Configured ElevenLabs voice";
  const speedRange = speedRangeForProvider(props.playback.provider, props.elevenLabs.speedRange);

  return <div className="simple-settings-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) props.onClose();
  }}>
    <section aria-labelledby="global-settings-title" aria-modal="true" className="simple-settings-panel" role="dialog">
      <header className="simple-settings-header">
        <div><h2 id="global-settings-title">Settings</h2><span>Audio and review timing</span></div>
        <button aria-label="Close settings" onClick={props.onClose} type="button"><X size={18} /></button>
      </header>

      <div className="simple-settings-scroll">
        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Voice</h3><span>Default for Cards</span></div>
          <div className="simple-provider-switch" role="group" aria-label="Voice provider">
            {(["openai", "elevenlabs"] as TtsProvider[]).map((provider) => <button
              className={props.playback.provider === provider ? "is-active" : ""}
              key={provider}
              onClick={() => props.onPlayback({ ...props.playback, provider })}
              type="button"
            >{provider === "openai" ? "OpenAI" : "ElevenLabs"}</button>)}
          </div>

          {props.playback.provider === "openai" ? <div className="simple-voice-grid">
            {props.voices.map((voice) => <button className={props.playback.voice === voice ? "is-active" : ""}
              key={voice} onClick={() => props.onPlayback({ ...props.playback, voice })} type="button">
              <span>{capitalize(voice)}</span>{["marin", "cedar"].includes(voice) ? <small>recommended</small> : null}
            </button>)}
            </div> : <>
              <div className="simple-elevenlabs-voice">
              <div><strong>{activeVoice.name}</strong><span>{voiceDetails}</span></div>
              <a href={`https://elevenlabs.io/app/voice-library?voiceId=${activeVoice.id}`} rel="noreferrer" target="_blank">Voice page</a>
            </div>
            <div className="simple-elevenlabs-status" aria-live="polite">
              <i className={voiceStatusState === "ready" ? "is-ready" : ""} />
              <div><span>{!props.elevenLabs.configured ? "API key missing"
                : voiceStatusState === "checking" ? "Checking this voice…"
                  : voiceStatusState === "ready" ? "Voice verified by ElevenLabs"
                    : "Voice could not be verified"}</span>
                <small>{voiceStatus?.error || "Identical audio is reused from the server cache"}</small></div>
              {props.elevenLabs.configured ? <button aria-label="Check ElevenLabs voice again"
                disabled={voiceStatusState === "checking"} onClick={() => void refreshVoiceStatus()} type="button">
                <RefreshCw className={voiceStatusState === "checking" ? "simple-spin" : ""} size={13} />
              </button> : null}
            </div>
            <div className="simple-model-choice">
              <span>Model</span><div>
                <button className={props.playback.elevenlabs.modelId === "eleven_multilingual_v2" ? "is-active" : ""}
                  onClick={() => updateElevenLabs("modelId", "eleven_multilingual_v2")} type="button">Quality</button>
                <button className={props.playback.elevenlabs.modelId === "eleven_flash_v2_5" ? "is-active" : ""}
                  onClick={() => updateElevenLabs("modelId", "eleven_flash_v2_5")} type="button">Fast</button>
              </div>
            </div>
            <div className="simple-voice-tuning">
              {([
                ["stability", "Stability"],
                ["similarityBoost", "Similarity"],
                ["style", "Style"],
              ] as const).map(([key, label]) => <label key={key}>
                <span>{label}<strong>{props.playback.elevenlabs[key].toFixed(2)}</strong></span>
                <input max="1" min="0" onChange={(event) => updateElevenLabs(key, Number(event.target.value))}
                  step="0.01" type="range" value={props.playback.elevenlabs[key]} />
              </label>)}
              <div className="simple-speaker-boost"><span>Speaker boost</span><button aria-pressed={props.playback.elevenlabs.speakerBoost}
                className={props.playback.elevenlabs.speakerBoost ? "is-active" : ""}
                onClick={() => updateElevenLabs("speakerBoost", !props.playback.elevenlabs.speakerBoost)} type="button"><i /></button></div>
            </div>
          </>}
          <button className="simple-voice-preview" disabled={previewState === "playing"
            || (props.playback.provider === "elevenlabs" && !props.elevenLabs.configured)}
            onClick={() => void preview()} type="button">
            {previewState === "playing" ? <LoaderCircle className="simple-spin" size={13} /> : <Play fill="currentColor" size={13} />}
            <span>Preview {props.playback.provider === "openai" ? capitalize(props.playback.voice) : activeVoice.name}</span>
          </button>
          {previewState === "error" ? <p className="simple-voice-error">{previewError}</p> : null}
          {previewNotice ? <p className="simple-voice-cache-note">{previewNotice}</p> : null}
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Playback</h3><span>Default for Cards</span></div>
          <div className="simple-global-playback">
            <div className="simple-global-setting"><label>Repeats</label><div>
              {[1, 2, 3, 5].map((value) => <button className={props.playback.repetitions === value ? "is-active" : ""}
                key={value} onClick={() => props.onPlayback({ ...props.playback, repetitions: value })} type="button">{value}×</button>)}
            </div></div>
            <label className="simple-global-setting simple-global-speed"><span>Speed <strong>{props.playback.speed.toFixed(2)}×</strong></span>
              <input max={speedRange.max} min={speedRange.min} onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })}
                step="0.05" type="range" value={props.playback.speed} /></label>
            <div className="simple-global-setting"><label>Pause</label><div>
              {[500, 1500, 3000].map((value) => <button className={props.playback.pauseMs === value ? "is-active" : ""}
                key={value} onClick={() => props.onPlayback({ ...props.playback, pauseMs: value })} type="button">{value / 1000}s</button>)}
            </div></div>
          </div>
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>FSRS-6</h3><span>Recall scheduler</span></div>
          <label className="simple-new-items-setting"><span>New cards per day</span><input max="30" min="0" onChange={(event) => {
            setDraft((current) => ({ ...current, newItemsPerDay: Number(event.target.value) })); setSaveState("idle");
          }} type="number" value={draft.newItemsPerDay} /></label>
          <div className="simple-fsrs-table">
            <div className="simple-fsrs-head"><span>Priority</span><span>Retention</span><span>Max interval</span></div>
            {(["like", "neutral", "dislike"] as ItemPreference[]).map((preference) => <div className="simple-fsrs-row" key={preference}>
              <strong>{capitalize(preference)}</strong>
              <label><input max="97" min="80" onChange={(event) => updatePreset(preference, "requestRetention", Number(event.target.value) / 100)}
                step="1" type="number" value={Math.round(draft.presets[preference].requestRetention * 100)} /><span>%</span></label>
              <label><input max="3650" min="7" onChange={(event) => updatePreset(preference, "maximumInterval", Number(event.target.value))}
                step="1" type="number" value={draft.presets[preference].maximumInterval} /><span>days</span></label>
            </div>)}
          </div>
          <div className="simple-fsrs-details">
            <label><span>Learning steps</span><input aria-invalid={!nextLearningSteps.length || nextLearningSteps.some((step) => !stepPattern.test(step))}
              onChange={(event) => { setLearningSteps(event.target.value); setSaveState("idle"); }} value={learningSteps} /></label>
            <label><span>Relearning steps</span><input aria-invalid={!nextRelearningSteps.length || nextRelearningSteps.some((step) => !stepPattern.test(step))}
              onChange={(event) => { setRelearningSteps(event.target.value); setSaveState("idle"); }} value={relearningSteps} /></label>
            <div className="simple-fsrs-toggle"><span>Interval fuzz</span><button aria-pressed={draft.fuzz} className={draft.fuzz ? "is-active" : ""}
              onClick={() => { setDraft((current) => ({ ...current, fuzz: !current.fuzz })); setSaveState("idle"); }} type="button"><i /></button></div>
          </div>
        </section>
      </div>

      <footer className="simple-settings-footer">
        <span className={`is-${saveState}`}>{saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn’t save" : !validSteps ? "Use steps like 1m, 10m" : ""}</span>
        <button className="simple-settings-save" disabled={!validSteps || saveState === "saving"} onClick={() => void save()} type="button">
          {saveState === "saving" ? "Saving…" : "Save FSRS"}
        </button>
      </footer>
    </section>
  </div>;
}
