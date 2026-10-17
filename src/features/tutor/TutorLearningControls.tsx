import { useRef, useState, type ReactNode } from "react";
import { LogOut, Settings, X } from "lucide-react";
import { PracticePicker } from "../practice/PracticePicker";
import { useSessionDraft } from "../../hooks/useSessionDraft";
import { TutorChatActions } from "./TutorChatActions";
import type { TutorLearningProfile, TutorMode } from "../../../contracts/tutor-adaptation";
import { apiFetch } from "../../shared/api";
import { tutorOnboardingCopy as copy } from "./tutorOnboardingCopy";

export function TutorLearningControls({ profile, threadId, busy, actions, draftKey, onProfile, onFinished }: {
  actions: ReactNode; draftKey: string;
  profile: TutorLearningProfile; threadId: string | null; busy: boolean;
  onProfile: (profile: TutorLearningProfile) => void; onFinished: () => void;
}) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [settingsDraft, setSettingsDraft] = useSessionDraft(draftKey);
  const { goals, interests } = settingsDraft ? JSON.parse(settingsDraft) as { goals: string; interests: string }
    : { goals: profile.goals.join(", "), interests: profile.interests.join(", ") };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeSettings = () => { setSettingsOpen(false); dialogRef.current?.close(); triggerRef.current?.focus({ preventScroll: true }); };
  const openSettings = () => {
    const dialog = dialogRef.current; const trigger = triggerRef.current;
    if (!dialog || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    dialog.style.top = `${rect.bottom + 4}px`;
    dialog.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
    dialog.showModal(); setSettingsOpen(true);
  };
  const update = async (patch: object) => {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/tutor/learning-profile", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: profile.targetLanguage, ...(threadId ? { threadId } : {}), ...patch }) });
      if (!response.ok) throw new Error();
      const next = (await response.json()).profile as TutorLearningProfile;
      onProfile(next);
      if ("goals" in patch) setSettingsDraft("");
      setNotice(copy.saved);
    } catch { setError(copy.settingsError); }
    finally { setSaving(false); }
  };
  const finish = async () => {
    if (!threadId || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch(`/api/chat/${threadId}/finish`, { method: "POST" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { counted: boolean; error?: string };
      if (result.error) { setError(copy.summaryError); return; }
      onFinished();
    } catch { setError(copy.finishError); }
    finally { setSaving(false); }
  };
  return <div className="tutor-learning-controls">
    <button className="tutor-settings-trigger" aria-label={copy.settings} aria-haspopup="dialog" aria-expanded={settingsOpen} title={copy.settings}
      ref={triggerRef} onClick={openSettings} type="button"><Settings aria-hidden="true" size={18} /></button>
    {threadId ? <TutorChatActions><button type="button" disabled={busy || saving} onClick={() => void finish()}>
      <LogOut aria-hidden="true" size={16} />{saving ? copy.saving : copy.end}</button>{actions}</TutorChatActions> : null}
    <dialog className="tutor-learning-settings" aria-labelledby="tutor-settings-title" ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); closeSettings(); }} onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSettings();
      }}>
      <header><h2 id="tutor-settings-title">{copy.settings}</h2><button aria-label="Close Tutor settings" onClick={closeSettings} type="button"><X size={18} /></button></header>
      <p className="tutor-settings-hint">Support settings apply immediately.</p>
      <fieldset disabled={busy || saving}>
        <div className="tutor-settings-field"><span>{copy.support}</span><PracticePicker label={copy.support} value={profile.interactionMode}
          options={Object.entries(copy.modeLabels).map(([value, label]) => ({ value, label }))}
          onChange={(mode) => void update({ mode: mode as TutorMode })} /></div>
        <p className="tutor-settings-hint">{copy.descriptions[profile.interactionMode]}</p>
        <div className="tutor-settings-field"><span>{copy.nativeHelp}</span><PracticePicker label={copy.nativeHelp}
          value={profile.customTutorSettings.nativeLanguageUsage || "inherit"}
          options={[{ value: "inherit", label: copy.inherit }, ...Object.entries(copy.nativeHelpLabels).map(([value, label]) => ({ value, label }))]}
          onChange={(value) => void update(value === "inherit" ? { removeOverrides: ["nativeLanguageUsage"] } : { overrides: { nativeLanguageUsage: value } })} /></div>
        <div className="tutor-settings-about">
          <label>{copy.goalsLabel}<textarea name="tutor-goals" autoComplete="off" maxLength={500} rows={2} value={goals} onChange={(event) => setSettingsDraft(JSON.stringify({ goals: event.target.value, interests }))} /></label>
          <label>{copy.interestsLabel}<textarea name="tutor-interests" autoComplete="off" maxLength={500} rows={3} value={interests} onChange={(event) => setSettingsDraft(JSON.stringify({ goals, interests: event.target.value }))} /></label>
        </div>
        <div className="tutor-settings-actions"><button className="simple-primary" type="button" onClick={() => void update({ goals: goals.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 8),
          interests: interests.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 8) })}>{copy.saveGoals}</button>
        <button className="tutor-settings-reset" type="button" onClick={() => void update({ resetOverrides: true })}>{copy.reset}</button></div>
      </fieldset>
      {notice ? <p className="tutor-settings-hint" role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </dialog>
    {error && !settingsOpen ? <p className="tutor-controls-error" role="alert">{error}</p> : null}
  </div>;
}
