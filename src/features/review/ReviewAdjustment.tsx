import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, LoaderCircle, RefreshCw, Shuffle, WandSparkles } from "lucide-react";
import type { Language } from "../../shared/contracts";
import type { ReviewCandidate } from "./ReviewBatchPanel";

export function ReviewAdjustment({ candidate, language, comment, regenerating, notice, onClose, onUpdate, onComment, onRegenerate, onRevise }: {
  candidate: ReviewCandidate;
  language: Language;
  comment: string;
  regenerating: { candidateId: string; instruction: "another" | "different_context" | "revise" } | null;
  notice: string;
  onClose: () => void;
  onUpdate: (patch: Partial<ReviewCandidate>) => void;
  onComment: (value: string) => void;
  onRegenerate: (instruction: "another" | "different_context") => Promise<void>;
  onRevise: () => Promise<void>;
}) {
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const dialog = dialogRef.current;
    dialog?.showModal(); headingRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, [mobile]);
  const fields = <div className="simple-review-adjustment">
            <label><span>Target sentence</span><textarea aria-label="Target phrase" autoComplete="off" lang={language} name={`review-target-${candidate.id}`} onChange={(event) => onUpdate({ target: event.target.value })} rows={2} value={candidate.target} /></label>
            <label><span>Russian cue</span><textarea aria-label="Russian cue" autoComplete="off" lang="ru" name={`review-cue-${candidate.id}`} onChange={(event) => onUpdate({ cue: event.target.value })} rows={2} value={candidate.cue} /></label>
            <details className="simple-review-alternatives" open={mobile ? undefined : true}><summary>Topic &amp; AI alternatives<ChevronDown aria-hidden="true" size={16} /></summary>
            <label><span>Topic</span><input aria-label="Category" autoComplete="off" name={`review-category-${candidate.id}`} onChange={(event) => onUpdate({ category: event.target.value })} value={candidate.category} /></label>
            <textarea aria-label="Comment for card"
              autoComplete="off" className="simple-review-comment" name={`review-comment-${candidate.id}`} onChange={(event) => {
                onComment(event.target.value);
              }} placeholder="What should change? Leave empty if this card is OK…" rows={2}
              value={comment || ""} />
            <div className="simple-review-actions">
              <button disabled={Boolean(regenerating)} onClick={() => void onRegenerate("another")} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "another"
                  ? <LoaderCircle aria-hidden="true" className="simple-spin" size={13} /> : <RefreshCw aria-hidden="true" size={13} />}Another</button>
              <button disabled={Boolean(regenerating)} onClick={() => void onRegenerate("different_context")} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "different_context"
                  ? <LoaderCircle aria-hidden="true" className="simple-spin" size={13} /> : <Shuffle aria-hidden="true" size={13} />}Change Context</button>
              <button className="simple-review-revise" disabled={!comment?.trim() || Boolean(regenerating)}
                onClick={() => void onRevise()} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "revise"
                  ? <LoaderCircle aria-hidden="true" className="simple-spin" size={13} /> : <WandSparkles aria-hidden="true" size={14} />}Revise</button>
            </div>
            </details>

    {notice ? <p role="status">{notice}</p> : null}
  </div>;
  if (!mobile) return fields;
  return <dialog aria-labelledby="review-adjust-title" className="simple-review-editor" ref={dialogRef}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><button aria-label="Back to review" onClick={onClose} type="button"><ArrowLeft aria-hidden="true" size={18} /></button>
      <h2 id="review-adjust-title" ref={headingRef} tabIndex={-1}>Adjust card</h2></header>
    {fields}
    <footer><button className="simple-primary" onClick={onClose} type="button">Done · back to review</button></footer>
  </dialog>;
}
