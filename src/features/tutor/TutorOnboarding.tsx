import { useEffect, useRef, useState } from "react";
import { onboardingAnswersSchema, tutorModes, type OnboardingAnswers, type TutorLearningProfile } from "../../../contracts/tutor-adaptation";
import { apiFetch } from "../../shared/api";
import { tutorOnboardingCopy as copy } from "./tutorOnboardingCopy";

export function TutorOnboarding({ profile, profileId, onProfile, onComplete }: {
  profile: TutorLearningProfile; profileId: string; onProfile: (profile: TutorLearningProfile) => void; onComplete: (profile: TutorLearningProfile) => void;
}) {
  const draftKey = `rehearsal:${profileId}:tutor-onboarding:${profile.targetLanguage}`;
  const [answers, setAnswers] = useState(() => {
    try { return onboardingAnswersSchema.parse(JSON.parse(window.sessionStorage.getItem(draftKey) || JSON.stringify(profile.answers))); }
    catch { return profile.answers; }
  });
  useEffect(() => { window.sessionStorage.setItem(draftKey, JSON.stringify(answers)); }, [answers, draftKey]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const step = profile.onboardingStep;
  useEffect(() => { heading.current?.focus(); }, [step]);
  const request = async (action: string, extra: object = {}) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/tutor/onboarding/${action}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: profile.targetLanguage, nativeLanguage: profile.nativeLanguage, ...extra }) });
      if (!response.ok) {
        if (response.status === 409) {
          const current = await apiFetch(`/api/tutor/learning-profile?language=${profile.targetLanguage}`);
          if (current.ok) onProfile((await current.json()).profile);
        }
        throw new Error();
      }
      const data = await response.json() as { profile: TutorLearningProfile };
      onProfile(data.profile);
      if (action !== "answer") { window.sessionStorage.removeItem(draftKey); onComplete(data.profile); }
    } catch { setError(copy.error); }
    finally { setBusy(false); }
  };
  const nextAnswers: OnboardingAnswers = step === 1 ? { comfort: answers.comfort } : step === 2 ? { goals: answers.goals || [] }
    : step === 3 ? { interests: answers.interests || "" } : step === 4 ? { preference: answers.preference }
    : step === 5 ? { sample: answers.sample || "", needsModel: Boolean(answers.needsModel) } : {};
  const canContinue = step === 1 ? Boolean(answers.comfort) : step === 4 ? Boolean(answers.preference)
    : step === 5 ? Boolean(answers.sample?.trim() || answers.needsModel) : true;
  return <main className="simple-main tutor-onboarding" id="main-content">
    <header><h1 ref={heading} tabIndex={-1}>{step === 0 ? copy.title : step < 5 ? copy.questions[step - 1] : step === 5 ? copy.startingTask : copy.ready}</h1>
      <button disabled={busy} type="button" onClick={() => void request("skip")}>{copy.skip}</button></header>
    {step === 0 ? <><p>{copy.intro}</p><ol className="tutor-learning-funnel" aria-label={copy.journey}>
      {copy.funnel.map(([title, description], index) => <li key={index}><strong><span aria-hidden="true">{index + 1}</span>{title}</strong><p>{description}</p></li>)}
    </ol><p>{copy.contentChoice}</p></> : null}
    {step > 0 && step < 5 ? <p className="tutor-onboarding-progress">{copy.questionProgress(step)}</p> : null}
    {step === 1 || step === 4 ? <fieldset className="tutor-onboarding-choices"><legend className="simple-visually-hidden">{copy.questions[step - 1]}</legend>
      {(step === 1 ? copy.comfort : copy.preferences).map((label, index) => <label key={label}>
        <input type="radio" name="tutor-support" value={tutorModes[index]} disabled={busy}
          checked={(step === 1 ? answers.comfort : answers.preference) === tutorModes[index]}
          onChange={() => setAnswers({ ...answers, [step === 1 ? "comfort" : "preference"]: tutorModes[index] })} />{label}</label>)}
    </fieldset> : null}
    {step === 2 ? <><fieldset className="tutor-onboarding-choices"><legend className="simple-visually-hidden">{copy.questions[1]}</legend>
      {copy.goals.map((goal) => <label key={goal}><input type="checkbox" name="tutor-goal" disabled={busy} checked={answers.goals?.includes(goal) || false}
        onChange={(event) => setAnswers({ ...answers, goals: event.target.checked ? [...answers.goals || [], goal] : answers.goals?.filter((value) => value !== goal) })} />{goal}</label>)}
      </fieldset><label>{copy.otherGoal}<input name="tutor-other-goal" autoComplete="off" maxLength={200} disabled={busy} value={answers.goals?.find((goal) => !copy.goals.includes(goal as typeof copy.goals[number])) || ""}
        onChange={(event) => setAnswers({ ...answers, goals: [...(answers.goals || []).filter((goal) => copy.goals.includes(goal as typeof copy.goals[number])), ...(event.target.value ? [event.target.value] : [])] })} /></label></> : null}
    {step === 3 ? <label>{copy.usefulInterests}<textarea name="tutor-interests" autoComplete="off" disabled={busy} maxLength={500} rows={4} value={answers.interests || ""}
      onChange={(event) => setAnswers({ ...answers, interests: event.target.value })} /></label> : null}
    {step === 5 ? <><p>{copy.task}</p><label>{copy.sentences}<textarea name="tutor-starting-sentences" autoComplete="off" disabled={busy} maxLength={1000} rows={4} value={answers.sample || ""}
      onChange={(event) => setAnswers({ ...answers, sample: event.target.value })} /></label>
      <button type="button" disabled={busy} onClick={() => setAnswers({ ...answers, needsModel: true })}>{copy.needExample}</button>
      {answers.needsModel ? <p>{copy.modelIntro} {copy.models[profile.targetLanguage]}</p> : null}</> : null}
    {step === 6 ? <p>{copy.descriptions[profile.interactionMode]}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <footer>{step > 0 ? <button disabled={busy} type="button" onClick={() => void request("answer", { expectedStep: step, step: step - 1, answers: {} })}>{copy.back}</button> : <span />}
      <button className="simple-primary" disabled={busy || !canContinue} type="button" onClick={() => void request(step === 6 ? "complete" : "answer", step === 6 ? {} : { expectedStep: step, step: step + 1, answers: nextAnswers })}>
        {busy ? copy.saving : step === 6 ? copy.start : copy.next}</button></footer>
  </main>;
}
