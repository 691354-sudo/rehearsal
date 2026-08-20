import { useEffect, useState } from "react";
import { Check, Volume2 } from "lucide-react";
import { ratingFromVerdict, reviewRatings, type ReviewRating } from "../../lib/sessionQueue";
import { capitalize, languageCopy } from "../../shared/config";
import type { AttemptDraft, Language, LearningItem } from "../../shared/contracts";

const formatInterval = (seconds?: number) => {
  if (seconds === undefined) return "";
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};

export function InlineRecallAnswer(props: {
  attempt: AttemptDraft;
  item: LearningItem;
  language: Language;
  playAfterCheck: boolean;
  onAnswer: (value: string) => void;
  onCheck: () => void;
  onCompleted: () => void;
  onPlay: () => Promise<unknown>;
  onReview: (rating: ReviewRating) => Promise<boolean>;
}) {
  const [rating, setRating] = useState<ReviewRating>("good");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (props.attempt.evaluation) setRating(ratingFromVerdict(props.attempt.evaluation.verdict));
  }, [props.attempt.evaluation]);

  const check = () => {
    if (!props.attempt.answer.trim() || props.attempt.evaluation) return;
    props.onCheck();
    if (props.language === "en" && props.playAfterCheck) void props.onPlay().catch(() => undefined);
  };
  const save = async (nextRating = rating) => {
    if (!props.attempt.evaluation || saving) return;
    setRating(nextRating); setSaving(true); setError("");
    if (await props.onReview(nextRating)) { setCompleted(true); props.onCompleted(); }
    else setError("Couldn’t save this review. Try again.");
    setSaving(false);
  };

  if (completed) return <div className="inline-recall-complete"><Check size={15} />Reviewed</div>;

  return <div className="practice-inline-recall">
    <div className="practice-inline-answer"><input aria-label={`Answer for ${props.item.cue}`} autoComplete="off" lang={props.language} name={`inline-recall-${props.item.publicId}`}
      onChange={(event) => { if (!props.attempt.evaluation) props.onAnswer(event.target.value); }}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); if (props.attempt.evaluation) void save(); else check(); }
        if (props.attempt.evaluation && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          const index = reviewRatings.indexOf(rating);
          setRating(reviewRatings[Math.max(0, Math.min(reviewRatings.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))]);
        }
      }} placeholder={`Type in ${languageCopy[props.language].label}…`} readOnly={Boolean(props.attempt.evaluation)} value={props.attempt.answer} />
      {!props.attempt.evaluation ? <button aria-label="Check answer" disabled={!props.attempt.answer.trim()} onClick={check} type="button"><Check size={15} /></button> : null}
    </div>
    {props.attempt.evaluation ? <div aria-live="polite" className={`practice-inline-result recall-result--${props.attempt.evaluation.verdict}`}>
      <span>{props.attempt.evaluation.verdict === "exact" ? "Correct" : "Compare"}</span>
      {props.attempt.evaluation.verdict !== "exact" ? <p className="recall-own-answer" lang={props.language}>{props.attempt.answer}</p> : null}
      <div className="recall-natural-row"><p className="recall-natural-answer" lang={props.language}>{props.attempt.evaluation.naturalAnswer}</p>
        {props.language === "en" ? <button aria-label="Play natural answer" onClick={() => void props.onPlay()} type="button"><Volume2 size={15} /></button> : null}</div>
      <div className="practice-inline-grades" aria-label="Memory grade">{reviewRatings.map((value) => <button aria-pressed={rating === value}
        disabled={saving} key={value} onClick={() => void save(value)} type="button"><span>{capitalize(value)}</span><small>{formatInterval(props.item.schedule?.options[value].intervalSeconds)}</small></button>)}</div>
      {error ? <p className="recall-save-error" role="alert">{error}</p> : null}
      <small className="practice-inline-hint">← → choose · Enter confirm</small>
    </div> : null}
  </div>;
}
