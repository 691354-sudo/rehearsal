import { useState } from "react";
import type { Homework, HomeworkFeedback as Feedback } from "../../../contracts/learning-pilot";
import { usePilot } from "./PilotProvider";
import { pilotErrorMessage, pilotRequest } from "./pilotApi";

export function HomeworkFeedback({ homework, onSaved, onClose }: {
  homework: Homework; onSaved: (homework: Homework) => void; onClose: () => void;
}) {
  const { profileId } = usePilot();
  const key = `rehearsal:${profileId}:en:feedback:${homework.homeworkId}`;
  const pendingKey = `${key}:submission`;
  const [pending, setPending] = useState<Partial<Feedback> | null>(() => JSON.parse(localStorage.getItem(pendingKey) || "null"));
  const [draft, setDraft] = useState<Partial<Feedback>>(() => pending ?? JSON.parse(localStorage.getItem(key) || "{}"));
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const update = (patch: Partial<Feedback>) => { const next = { ...draft, ...patch }; localStorage.setItem(key, JSON.stringify(next)); setDraft(next); };
  const submit = async () => {
    if (!draft.difficulty || !draft.timeFit || !draft.nextStepClarity || saving) return;
    setSaving(true); setError("");
    try {
      const submission = pending ?? draft;
      localStorage.setItem(pendingKey, JSON.stringify(submission));
      setPending(submission);
      const result = await pilotRequest<{ homework: Homework }>(profileId, `/homework/${homework.homeworkId}/feedback`, submission);
      localStorage.removeItem(pendingKey); localStorage.removeItem(key); onSaved(result.homework);
    } catch (caught) { setError(pilotErrorMessage(caught)); }
    finally { setSaving(false); }
  };
  return <section className="pilot-feedback" aria-label="Homework feedback">
    <h2 tabIndex={-1}>How did it go?</h2>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>How difficult was it?<select disabled={saving || Boolean(pending)} name="difficulty" autoComplete="off" required value={draft.difficulty || ""} onChange={(event) => update({ difficulty: event.target.value as Feedback["difficulty"] })}>
        <option value="" disabled>Choose</option><option value="too_easy">Too easy</option><option value="about_right">About right</option><option value="too_hard">Too hard</option></select></label>
      <label>How did the time feel?<select disabled={saving || Boolean(pending)} name="time-fit" autoComplete="off" required value={draft.timeFit || ""} onChange={(event) => update({ timeFit: event.target.value as Feedback["timeFit"] })}>
        <option value="" disabled>Choose</option><option value="shorter">Shorter than expected</option><option value="as_expected">As expected</option><option value="longer">Longer than expected</option></select></label>
      <label>Was the next step clear?<select disabled={saving || Boolean(pending)} name="next-step-clarity" autoComplete="off" required value={draft.nextStepClarity || ""} onChange={(event) => update({ nextStepClarity: event.target.value as Feedback["nextStepClarity"] })}>
        <option value="" disabled>Choose</option><option value="yes">Yes</option><option value="not_always">Not always</option><option value="no">No</option></select></label>
      <details><summary>Anything else? <span>Optional</span></summary>
        <label>Did Tutor help?<select disabled={saving || Boolean(pending)} name="tutor-helpfulness" autoComplete="off" value={draft.tutorHelpfulness || ""} onChange={(event) => update({ tutorHelpfulness: event.target.value as Feedback["tutorHelpfulness"] || undefined })}>
          <option value="">Skip</option><option value="yes">Yes</option><option value="partly">Partly</option><option value="no">No</option><option value="didnt_reach_tutor">I didn't reach Tutor</option></select></label>
        <label>What got in the way?<textarea disabled={saving || Boolean(pending)} name="obstacle" autoComplete="off" maxLength={1000} value={draft.obstacleText || ""} onChange={(event) => update({ obstacleText: event.target.value })} /></label>
        <label>What would you like to practise?<textarea disabled={saving || Boolean(pending)} name="requested-practice" autoComplete="off" maxLength={1000} value={draft.requestedPracticeText || ""} onChange={(event) => update({ requestedPracticeText: event.target.value })} /></label>
      </details>
      {error ? <p role="alert">{error}</p> : null}
      <div className="pilot-actions"><button className="simple-primary" disabled={saving || !draft.difficulty || !draft.timeFit || !draft.nextStepClarity} type="submit">{saving ? "Saving…" : "Finish Homework"}</button>
        <button disabled={saving} onClick={onClose} type="button">Continue later</button></div>
    </form>
  </section>;
}
