import { useState } from "react";
import type { TutorLearningProfile, TutorMode } from "../../../contracts/tutor-adaptation";
import { apiFetch } from "../../shared/api";
import { tutorOnboardingCopy as copy } from "./tutorOnboardingCopy";

export function TutorLearningControls({ profile, threadId, busy, onProfile, onFinished }: {
  profile: TutorLearningProfile; threadId: string | null; busy: boolean;
  onProfile: (profile: TutorLearningProfile) => void; onFinished: () => void;
}) {
  const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [goals, setGoals] = useState(profile.goals.join(", "));
  const [interests, setInterests] = useState(profile.interests.join(", "));
  const update = async (patch: object) => {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await apiFetch("/api/tutor/learning-profile", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: profile.targetLanguage, ...(threadId ? { threadId } : {}), ...patch }) });
      if (!response.ok) throw new Error();
      onProfile((await response.json()).profile); setNotice(copy.saved);
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
    <details><summary>{copy.settings}</summary><div className="tutor-learning-settings">
      <label>{copy.support}<select name="tutor-support-style" disabled={busy || saving} value={profile.interactionMode} onChange={(event) => void update({ mode: event.target.value as TutorMode })}>
        {Object.entries(copy.modeLabels).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
      <label>{copy.nativeHelp}<select name="tutor-native-help" disabled={busy || saving} value={profile.customTutorSettings.nativeLanguageUsage || "inherit"}
        onChange={(event) => void update(event.target.value === "inherit" ? { removeOverrides: ["nativeLanguageUsage"] } : { overrides: { nativeLanguageUsage: event.target.value } })}>
        <option value="inherit">{copy.inherit}</option>{Object.entries(copy.nativeHelpLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>{copy.goalsLabel}<input name="tutor-goals" autoComplete="off" maxLength={500} disabled={saving} value={goals} onChange={(event) => setGoals(event.target.value)} /></label>
      <label>{copy.interestsLabel}<input name="tutor-interests" autoComplete="off" maxLength={500} disabled={saving} value={interests} onChange={(event) => setInterests(event.target.value)} /></label>
      <button type="button" disabled={busy || saving} onClick={() => void update({ goals: goals.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 8),
        interests: interests.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 8) })}>{copy.saveGoals}</button>
      <button type="button" disabled={busy || saving} onClick={() => void update({ resetOverrides: true })}>{copy.reset}</button>
      {notice ? <p role="status">{notice}</p> : null}
    </div></details>
    {threadId ? <button type="button" disabled={busy || saving} onClick={() => void finish()}>{saving ? copy.saving : copy.end}</button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
