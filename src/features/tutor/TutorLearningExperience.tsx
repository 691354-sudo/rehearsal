import { useEffect, useState, type ComponentProps } from "react";
import type { TutorLearningProfile } from "../../../contracts/tutor-adaptation";
import { apiFetch } from "../../shared/api";
import { TutorPage } from "./TutorPage";
import { TutorOnboarding } from "./TutorOnboarding";
import { TutorLearningControls } from "./TutorLearningControls";
import { tutorOnboardingCopy as copy } from "./tutorOnboardingCopy";

export function TutorLearningExperience(props: ComponentProps<typeof TutorPage>) {
  const [state, setState] = useState<{ enabled: boolean; profile: TutorLearningProfile | null } | null>(null);
  const [error, setError] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (props.route.mode !== "chat") return;
    const controller = new AbortController(); setError(false); setState(null);
    void apiFetch(`/api/tutor/learning-profile?language=${props.language}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json(); if (!controller.signal.aborted) setState(data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [props.profileId, props.language, props.route.mode, revision]);
  const onProfile = (profile: TutorLearningProfile) => setState((current) => ({ enabled: current?.enabled ?? true, profile }));
  const profile = state?.profile;
  if (props.route.mode === "chat" && !state && !error) return <main className="simple-main" id="main-content"><p role="status">{copy.opening}</p></main>;
  if (props.route.mode === "chat" && state?.enabled && profile && ["not_started", "in_progress"].includes(profile.onboardingStatus)) {
    return <TutorOnboarding key={`${props.profileId}:${props.language}`} profile={profile} profileId={props.profileId} onProfile={onProfile}
      onComplete={(next) => props.onRoute({ ...props.route, thread: next.firstExerciseThreadId, review: null, homework: undefined }, "replace")} />;
  }
  return <>{error ? <p role="status">{copy.loadingError} <button type="button" onClick={() => setRevision((value) => value + 1)}>{copy.retry}</button></p> : null}
    <TutorPage {...props} learningControls={state?.enabled && profile ? (busy) => <TutorLearningControls profile={profile} threadId={props.route.thread} busy={busy}
      onProfile={onProfile} onFinished={() => { window.localStorage.removeItem(`rehearsal:${props.profileId}:tutor-thread:${props.language}`);
        props.onRoute({ ...props.route, thread: null, review: null, homework: undefined }); setRevision((value) => value + 1); }} /> : undefined} /></>;
}
