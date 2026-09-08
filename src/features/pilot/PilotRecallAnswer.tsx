import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleX, Clock3, Ear, WifiOff } from "lucide-react";
import type { RecallCheck } from "../../../contracts/recall-check";
import { pilotRequest } from "./pilotApi";

export function RecallCheckedText({ answer, mistakes }: { answer: string; mistakes: RecallCheck["mistakes"] }) {
  const ranges = mistakes.filter((mistake) => mistake.original).map((mistake) => ({
    start: answer.indexOf(mistake.original), text: mistake.original,
  })).filter((range) => range.start >= 0).sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = []; let end = 0;
  for (const range of ranges) {
    if (range.start < end) continue;
    parts.push(answer.slice(end, range.start), <mark key={range.start}>{range.text}</mark>);
    end = range.start + range.text.length;
  }
  parts.push(answer.slice(end));
  return <>{parts}</>;
}

export function PilotRecallAnswer({ profileId, attemptId, answer, saved, onChecked }: {
  profileId: string; attemptId: string; answer: string; saved?: RecallCheck;
  onChecked: (check: RecallCheck) => void;
}) {
  const [check, setCheck] = useState(saved);
  const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  const onCheckedRef = useRef(onChecked); onCheckedRef.current = onChecked;
  useEffect(() => {
    if (!answer.trim() || saved) return;
    let cancelled = false;
    setFailed(false);
    void pilotRequest<{ check: RecallCheck }>(profileId, "/attempts/check", { attemptId, answer })
      .then((result) => { if (!cancelled) { setCheck(result.check); onCheckedRef.current(result.check); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [profileId, attemptId, answer, retry, saved]);
  const oral = !answer.trim();
  const verdict = oral ? "oral" : check?.verdict ?? (failed ? "unavailable" : "checking");
  const Icon = oral ? Ear : verdict === "correct" ? CheckCircle2 : verdict === "incorrect" ? CircleX : failed ? WifiOff : Clock3;
  const title = oral ? "Compare your answer" : verdict === "correct" ? "Correct"
    : verdict === "incorrect" ? "Needs a correction" : failed ? "Answer not checked" : "Checking your answer…";
  return <div className={`pilot-answer-check pilot-answer-check--${verdict}`} role="status">
    <strong><Icon aria-hidden="true" size={18} />{title}</strong>
    {!oral ? <p lang="en"><RecallCheckedText answer={answer} mistakes={check?.mistakes ?? []} /></p> : null}
    {check ? <p className="pilot-check-explanation" lang="ru">{check.explanationRu}</p>
      : oral ? <p className="pilot-check-explanation">Compare your spoken answer with the card, then rate your memory.</p>
        : failed ? <><p className="pilot-check-explanation">Try again or compare your answer yourself.</p>
          <button onClick={() => { setFailed(false); setRetry((value) => value + 1); }} type="button">Retry check</button></> : null}
    {check?.verdict === "incorrect" && check.correctedAnswer !== answer ? <p className="pilot-check-correction" lang="en"><span>Correction</span>{check.correctedAnswer}</p> : null}
  </div>;
}
