import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, Play, RefreshCw, Share2, UserPlus, X } from "lucide-react";
import { speedRangeForProvider } from "../../lib/playbackSettings";
import { apiFetch } from "../../shared/api";
import { capitalize, humanizeLabel } from "../../shared/config";
import type { InvitationPurpose, OnboardingState, ProfileId } from "../../../contracts/api";
import type {
  ElevenLabsConfig,
  ElevenLabsPreferences,
  ElevenLabsVoiceStatus,
  ItemPreference,
  Language,
  PlaybackPreferences,
  PlaybackResult,
  SchedulerSettings,
  TtsProvider,
} from "../../shared/contracts";
import type { AppRoute } from "../../lib/appRoute";

export function GlobalSettings(props: {
  elevenLabs: ElevenLabsConfig;
  language: Language;
  onboarding: OnboardingState;
  onClose: () => void;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPreview: () => Promise<PlaybackResult>;
  onReplayOnboarding: () => void;
  onSaveScheduler: (settings: SchedulerSettings) => Promise<void>;
  playback: PlaybackPreferences;
  scheduler: SchedulerSettings;
  profileId: ProfileId;
  voices: string[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allowNavigationRef = useRef(false);
  const schedulerDirtyRef = useRef(false);
  const [draft, setDraft] = useState(props.scheduler);
  const [learningSteps, setLearningSteps] = useState(props.scheduler.learningSteps.join(", "));
  const [relearningSteps, setRelearningSteps] = useState(props.scheduler.relearningSteps.join(", "));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [schedulerTouched, setSchedulerTouched] = useState(false);
  const [previewState, setPreviewState] = useState<"idle" | "playing" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const [previewNotice, setPreviewNotice] = useState("");
  const [playbackApplied, setPlaybackApplied] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<ElevenLabsVoiceStatus | null>(null);
  const [voiceStatusState, setVoiceStatusState] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [inviteState, setInviteState] = useState<"idle" | "creating" | "ready" | "error" | "copied">("idle");
  const [inviteUrl, setInviteUrl] = useState("");
  const [invitePurpose, setInvitePurpose] = useState<InvitationPurpose>("standard");
  const [inviteError, setInviteError] = useState("");
  const compatibleElevenLabsVoices = props.elevenLabs.voicesByLanguage[props.language] || [];
  const selectedElevenLabsVoice = compatibleElevenLabsVoices.find(
    (voice) => voice.id === props.playback.elevenlabs.voiceId,
  ) || compatibleElevenLabsVoices[0] || { id: "", name: "No compatible voice" };

  useEffect(() => {
    if (!props.elevenLabs.configured || !selectedElevenLabsVoice.id) return;
    const controller = new AbortController();
    setVoiceStatus(null);
    setVoiceStatusState("checking");
    void apiFetch(`/api/audio/elevenlabs/status?voiceId=${encodeURIComponent(selectedElevenLabsVoice.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Voice check failed");
        const status = await response.json() as ElevenLabsVoiceStatus;
        if (controller.signal.aborted) return;
        setVoiceStatus(status);
        setVoiceStatusState(status.reachable ? "ready" : "error");
      })
      .catch(() => { if (!controller.signal.aborted) setVoiceStatusState("error"); });
    return () => controller.abort();
  }, [props.elevenLabs.configured, selectedElevenLabsVoice.id]);
  useEffect(() => {
    if (schedulerTouched) return;
    setDraft(props.scheduler);
    setLearningSteps(props.scheduler.learningSteps.join(", "));
    setRelearningSteps(props.scheduler.relearningSteps.join(", "));
  }, [props.scheduler, schedulerTouched]);

  const parseSteps = (value: string) => value.split(/[\s,]+/).map((step) => step.trim()).filter(Boolean);
  const stepPattern = /^\d+(?:\.\d+)?[mhd]$/;
  const nextLearningSteps = parseSteps(learningSteps);
  const nextRelearningSteps = parseSteps(relearningSteps);
  const validSteps = [nextLearningSteps, nextRelearningSteps]
    .every((steps) => steps.length > 0 && steps.length <= 4 && steps.every((step) => stepPattern.test(step)));
  const validNewItems = Number.isInteger(draft.newItemsPerDay) && draft.newItemsPerDay >= 0 && draft.newItemsPerDay <= 30;
  const validPresets = Object.values(draft.presets).every((preset) => Number.isInteger(preset.requestRetention * 100)
    && preset.requestRetention >= 0.8 && preset.requestRetention <= 0.97
    && Number.isInteger(preset.maximumInterval) && preset.maximumInterval >= 7 && preset.maximumInterval <= 3650);
  const validScheduler = validSteps && validNewItems && validPresets;
  const nextScheduler = {
    ...draft,
    learningSteps: nextLearningSteps,
    relearningSteps: nextRelearningSteps,
  };
  const schedulerDirty = schedulerTouched && JSON.stringify(nextScheduler) !== JSON.stringify(props.scheduler);
  schedulerDirtyRef.current = schedulerDirty;
  const requestClose = useCallback(() => {
    if (schedulerDirtyRef.current && !window.confirm("Discard unsaved Recall scheduling changes?")) return;
    allowNavigationRef.current = true;
    props.onClose();
  }, [props.onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const cancel = (event: Event) => { event.preventDefault(); requestClose(); };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [requestClose]);
  useEffect(() => {
    if (!schedulerDirty) return;
    const warn = (event: Event) => {
      const next = (event as CustomEvent<{ route: AppRoute }>).detail?.route;
      if (next?.settings || allowNavigationRef.current || window.confirm("Discard unsaved Recall scheduling changes?")) return;
      event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("app-before-navigate", warn);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("app-before-navigate", warn);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [schedulerDirty]);

  const save = async () => {
    if (!validScheduler || saveState === "saving") return;
    setSaveState("saving");
    try {
      await props.onSaveScheduler(nextScheduler);
      setSchedulerTouched(false);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const applyPlayback = (next: PlaybackPreferences) => {
    props.onPlayback(next);
    setPlaybackApplied(true);
  };

  const updatePreset = (
    preference: ItemPreference,
    field: "requestRetention" | "maximumInterval",
    value: number,
  ) => {
    setSchedulerTouched(true); setSaveState("idle");
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
    applyPlayback({
      ...props.playback,
      elevenlabs: { ...props.playback.elevenlabs, [key]: value },
    });
  };

  const refreshVoiceStatus = async () => {
    if (!selectedElevenLabsVoice.id) return;
    setVoiceStatusState("checking");
    try {
      const response = await apiFetch(`/api/audio/elevenlabs/status?refresh=true&voiceId=${encodeURIComponent(selectedElevenLabsVoice.id)}`);
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

  const createInvite = async (purpose: InvitationPurpose = "standard") => {
    setInviteState("creating");
    setInvitePurpose(purpose);
    setInviteError("");
    try {
      const response = await apiFetch("/api/auth/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose }),
      });
      if (!response.ok) {
        setInviteError(response.status === 409 && purpose === "onboarding_v1_pilot"
          ? "The onboarding test account already exists."
          : "Couldn’t create an invitation.");
        throw new Error("Invitation failed");
      }
      const result = await response.json() as { token: string };
      const relative = `${import.meta.env.BASE_URL}join?invite=${encodeURIComponent(result.token)}`;
      setInviteUrl(new URL(relative, window.location.origin).toString());
      setInviteState("ready");
    } catch {
      setInviteState("error");
    }
  };

  const openOnboarding = () => {
    if (schedulerDirtyRef.current && !window.confirm("Discard unsaved Recall scheduling changes?")) return;
    allowNavigationRef.current = true;
    props.onReplayOnboarding();
  };

  const copyInvite = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setInviteState("copied");
  };

  const activeVoice = voiceStatus?.reachable && voiceStatus.voice.id === selectedElevenLabsVoice.id ? voiceStatus.voice : {
    ...selectedElevenLabsVoice,
    category: "",
    description: "",
    labels: {} as Record<string, string>,
  };
  const voiceDetails = [activeVoice.labels.accent, activeVoice.labels.use_case, activeVoice.labels.gender]
    .filter(Boolean).map(humanizeLabel).join(" · ") || "ElevenLabs voice";
  const speedRange = speedRangeForProvider(props.playback.provider, props.elevenLabs.speedRange);
  const availableProviders: TtsProvider[] = props.language === "vi" || props.language === "no"
    ? ["elevenlabs"] : ["openai", "elevenlabs"];

  return <dialog className="simple-settings-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) requestClose();
  }} ref={dialogRef}>
    <section aria-labelledby="global-settings-title" className="simple-settings-panel">
      <header className="simple-settings-header">
        <div><h2 id="global-settings-title">Settings</h2><span className={playbackApplied ? "is-applied" : ""} role="status">
          <Check size={12} />{playbackApplied ? "Applied to next card" : "Changes apply to next card"}
        </span></div>
        <button aria-label="Close settings" onClick={requestClose} type="button"><X size={18} /></button>
      </header>

      <div className="simple-settings-scroll">
        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Voice</h3></div>
          <div className="simple-provider-switch" role="group" aria-label="Voice provider">
            {availableProviders.map((provider) => <button
              className={props.playback.provider === provider ? "is-active" : ""}
              key={provider}
              onClick={() => applyPlayback({ ...props.playback, provider })}
              type="button"
            >{provider === "openai" ? "OpenAI" : "ElevenLabs"}</button>)}
          </div>

          {props.playback.provider === "openai" ? <label className="simple-openai-voice-choice"><span>Voice</span>
            <select name="openai-voice" onChange={(event) => applyPlayback({ ...props.playback, voice: event.target.value })} value={props.playback.voice}>
              {props.voices.map((voice) => <option key={voice} value={voice}>{capitalize(voice)}{voice === "onyx" ? " · recommended" : ""}</option>)}
            </select>
          </label> : <>
            <label className="simple-openai-voice-choice"><span>Voice</span>
              <select disabled={!compatibleElevenLabsVoices.length} name="elevenlabs-voice"
                onChange={(event) => updateElevenLabs("voiceId", event.target.value)} value={selectedElevenLabsVoice.id}>
                {!compatibleElevenLabsVoices.length ? <option value="">No compatible voice configured</option> : null}
                {compatibleElevenLabsVoices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
              </select>
            </label>
            <div className="simple-elevenlabs-voice">
              <div><strong>{activeVoice.name}</strong><span>{voiceDetails}</span></div>
              <i aria-label={voiceStatusState === "ready" ? "Voice ready" : "Voice status unavailable"}
                className={voiceStatusState === "ready" ? "is-ready" : ""} role="img" />
            </div>
            <details className="simple-advanced-voice">
              <summary>Advanced voice</summary>
              <div className="simple-advanced-voice-body">
                <div className="simple-elevenlabs-status" aria-live="polite">
                  <i className={voiceStatusState === "ready" ? "is-ready" : ""} />
                  <div><span>{!props.elevenLabs.configured ? "API key missing"
                    : voiceStatusState === "checking" ? "Checking voice…"
                      : voiceStatusState === "ready" ? "Voice verified"
                        : "Voice unavailable"}</span>
                    {voiceStatus?.error ? <small>{voiceStatus.error}</small> : null}</div>
                  {props.elevenLabs.configured ? <button aria-label="Check ElevenLabs voice again"
                    disabled={voiceStatusState === "checking"} onClick={() => void refreshVoiceStatus()} type="button">
                    <RefreshCw className={voiceStatusState === "checking" ? "simple-spin" : ""} size={13} />
                  </button> : null}
                </div>
                <div className="simple-model-choice">
                  <span>Model</span><div>
                    {props.language !== "vi" && props.language !== "no" ? <button className={props.playback.elevenlabs.modelId === "eleven_multilingual_v2" ? "is-active" : ""}
                      onClick={() => updateElevenLabs("modelId", "eleven_multilingual_v2")} type="button">Quality</button> : null}
                    <button className={props.playback.elevenlabs.modelId === "eleven_flash_v2_5" ? "is-active" : ""}
                      onClick={() => updateElevenLabs("modelId", "eleven_flash_v2_5")} type="button">Fast</button>
                  </div>
                </div>
                <a className="simple-voice-page" href={`https://elevenlabs.io/app/voice-library?voiceId=${activeVoice.id}`} rel="noreferrer" target="_blank">Open voice page</a>
              </div>
            </details>
          </>}
          <button className="simple-voice-preview" disabled={previewState === "playing"
            || (props.playback.provider === "elevenlabs" && (!props.elevenLabs.configured || !selectedElevenLabsVoice.id))}
            onClick={() => void preview()} type="button">
            {previewState === "playing" ? <LoaderCircle className="simple-spin" size={13} /> : <Play fill="currentColor" size={13} />}
            <span>Preview {props.playback.provider === "openai" ? capitalize(props.playback.voice) : activeVoice.name}</span>
          </button>
          {previewState === "error" ? <p className="simple-voice-error" role="alert">{previewError}</p> : null}
          {previewNotice ? <p className="simple-voice-cache-note" role="status">{previewNotice}</p> : null}
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Card playback</h3></div>
          <label className="simple-recall-audio-setting"><input checked={props.playback.playAfterRecall} name="play-after-recall"
            onChange={(event) => applyPlayback({ ...props.playback, playAfterRecall: event.target.checked })} type="checkbox" />
            <span><strong>Play answer after checking</strong><small>Recall only</small></span></label>
          <div className="simple-global-playback">
            <div className="simple-global-setting"><label>Repeats</label><div>
              {[1, 2, 3, 5].map((value) => <button className={props.playback.repetitions === value ? "is-active" : ""}
                key={value} onClick={() => applyPlayback({ ...props.playback, repetitions: value })} type="button">{value}×</button>)}
            </div></div>
            <label className="simple-global-setting simple-global-speed"><span>Speed <strong>{props.playback.speed.toFixed(2)}×</strong></span>
              <input aria-label="Playback speed" max={speedRange.max} min={speedRange.min} name="playback-speed" onChange={(event) => applyPlayback({ ...props.playback, speed: Number(event.target.value) })}
                step="0.05" type="range" value={props.playback.speed} /></label>
            <div className="simple-global-setting simple-adaptive-pause"><label>Pause</label><strong>Adaptive · audio length + 0.5s</strong></div>
          </div>
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Recall scheduling</h3></div>
          <label className="simple-new-items-setting"><span>New cards per day</span><input aria-invalid={!validNewItems} max="30" min="0" name="new-cards-per-day" onChange={(event) => {
            setSchedulerTouched(true); setDraft((current) => ({ ...current, newItemsPerDay: Number(event.target.value) })); setSaveState("idle");
          }} type="number" value={draft.newItemsPerDay} /></label>
          <details className="simple-advanced-settings">
            <summary>Advanced scheduling</summary>
            <div className="simple-fsrs-table">
              <div className="simple-fsrs-head"><span>Priority</span><span>Retention</span><span>Max interval</span></div>
              {(["like", "neutral", "dislike"] as ItemPreference[]).map((preference) => <div className="simple-fsrs-row" key={preference}>
                <strong>{capitalize(preference)}</strong>
                <label><input aria-label={`${capitalize(preference)} retention`} aria-invalid={!Number.isInteger(draft.presets[preference].requestRetention * 100) || draft.presets[preference].requestRetention < 0.8 || draft.presets[preference].requestRetention > 0.97} max="97" min="80" name={`${preference}-retention`} onChange={(event) => updatePreset(preference, "requestRetention", Number(event.target.value) / 100)}
                  step="1" type="number" value={Math.round(draft.presets[preference].requestRetention * 100)} /><span>%</span></label>
                <label><input aria-label={`${capitalize(preference)} maximum interval`} aria-invalid={!Number.isInteger(draft.presets[preference].maximumInterval) || draft.presets[preference].maximumInterval < 7 || draft.presets[preference].maximumInterval > 3650} max="3650" min="7" name={`${preference}-maximum-interval`} onChange={(event) => updatePreset(preference, "maximumInterval", Number(event.target.value))}
                  step="1" type="number" value={draft.presets[preference].maximumInterval} /><span>days</span></label>
              </div>)}
            </div>
            <div className="simple-fsrs-details">
              <label><span>Learning steps</span><input aria-invalid={!nextLearningSteps.length || nextLearningSteps.length > 4 || nextLearningSteps.some((step) => !stepPattern.test(step))} autoComplete="off" name="learning-steps"
                onChange={(event) => { setSchedulerTouched(true); setLearningSteps(event.target.value); setSaveState("idle"); }} value={learningSteps} /></label>
              <label><span>Relearning steps</span><input aria-invalid={!nextRelearningSteps.length || nextRelearningSteps.length > 4 || nextRelearningSteps.some((step) => !stepPattern.test(step))} autoComplete="off" name="relearning-steps"
                onChange={(event) => { setSchedulerTouched(true); setRelearningSteps(event.target.value); setSaveState("idle"); }} value={relearningSteps} /></label>
              <div className="simple-fsrs-toggle"><span>Interval fuzz</span><button aria-label="Interval fuzz" aria-pressed={draft.fuzz} className={draft.fuzz ? "is-active" : ""}
                onClick={() => { setSchedulerTouched(true); setDraft((current) => ({ ...current, fuzz: !current.fuzz })); setSaveState("idle"); }} type="button"><i /></button></div>
            </div>
          </details>
        </section>

        <section className="simple-settings-section simple-invite-section">
          <div className="simple-settings-section-title"><h3>Invite someone</h3></div>
          <p>Create a one-time link for a new, empty profile. The link does not expire.</p>
          {!inviteUrl ? <div className="simple-invite-actions"><button className="simple-invite-create" disabled={inviteState === "creating"}
            onClick={() => void createInvite("standard")} type="button">
            {inviteState === "creating" && invitePurpose === "standard" ? <LoaderCircle className="simple-spin" size={15} /> : <UserPlus size={15} />}
            {inviteState === "creating" && invitePurpose === "standard" ? "Creating…" : "Create invitation"}
          </button>{props.profileId === "roman" ? <button className="simple-pilot-invite-create" disabled={inviteState === "creating"}
            onClick={() => void createInvite("onboarding_v1_pilot")} type="button">
            {inviteState === "creating" && invitePurpose === "onboarding_v1_pilot"
              ? <LoaderCircle className="simple-spin" size={15} /> : <UserPlus size={15} />}
            {inviteState === "creating" && invitePurpose === "onboarding_v1_pilot"
              ? "Creating test invitation…" : "Create onboarding test invitation"}
          </button> : null}</div> : <div aria-live="polite" className="simple-invite-result">
            {invitePurpose === "onboarding_v1_pilot" ? <small>Onboarding pilot · replaces any unused pilot link</small> : null}
            <input aria-label="Invitation link" readOnly value={inviteUrl} />
            <div>
              <button onClick={() => void copyInvite()} type="button"><Copy size={14} />
                {inviteState === "copied" ? "Copied" : "Copy"}</button>
              {navigator.share ? <button onClick={() => void navigator.share({ title: "Join Echo", url: inviteUrl })}
                type="button"><Share2 size={14} />Share</button> : null}
              <button onClick={() => { setInviteUrl(""); setInviteState("idle"); setInviteError(""); }} type="button">Create another</button>
            </div>
          </div>}
          {inviteState === "error" ? <p className="simple-voice-error" role="alert">{inviteError || "Couldn’t create an invitation."}</p> : null}
        </section>
        {props.onboarding.eligibility === "pilot" ? <section className="simple-settings-section simple-onboarding-help">
          <div className="simple-settings-section-title"><h3>How Echo works</h3></div>
          <p>Reopen the guided tour inside Tutor, Notebook, Library, and Practice. Your cards will not be changed.</p>
          <button onClick={openOnboarding} type="button">Open guided tour</button>
        </section> : null}
      </div>
      <footer className="simple-settings-footer">
        <span aria-live="polite" className={`is-${saveState}`}>{saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn’t save" : !validSteps ? "Use 1–4 steps like 1m, 10m" : !validNewItems || !validPresets ? "Use 0–30 cards, 80–97%, and 7–3650 days" : ""}</span>
        <button className="simple-settings-save" disabled={!schedulerDirty || !validScheduler || saveState === "saving"} onClick={() => void save()} type="button">
          {saveState === "saving" ? "Saving…" : "Save recall settings"}
        </button>
      </footer>
    </section>
  </dialog>;
}
