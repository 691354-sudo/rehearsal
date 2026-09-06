import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, LoaderCircle, RotateCcw, Pencil } from "lucide-react";
import { ReviewAdjustment } from "./ReviewAdjustment";
import { apiFetch } from "../../shared/api";
import { FocusedText } from "../progress/FocusedText";
import type { Language } from "../../shared/contracts";

export type ReviewCandidate = {
  id: string;
  target: string;
  cue: string;
  note: string;
  category: string;
  focusTerms: string[];
  pattern?: string;
  disposition?: "active" | "recognition" | "skip";
  frequencyBand: "core" | "common" | "specific" | "rare";
  currency: "current" | "contextual" | "dated" | "uncertain";
  personaFit: number;
  naturalness: number;
  commonness: number;
};

export type ReviewBatch = {
  publicId: string;
  language: Language;
  title: string;
  kind: "chat_review" | "vocab" | "text_import" | "pattern_drill" | "capture";
  candidates: ReviewCandidate[];
  status: "draft" | "committed";
  destinationTopicTitle: string | null;
  sourceThreadPublicId?: string | null;
};

const pageSize = 8;

export function ReviewBatchPanel(props: {
  batch: ReviewBatch;
  context?: "notebook" | "tutor";
  feed?: boolean;
  onBatch: (batch: ReviewBatch) => void;
  onCommitted?: (count: number) => void;
  onDismiss?: () => void;
  onReset?: () => Promise<void>;
  source?: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [regenerating, setRegenerating] = useState<{
    candidateId: string; instruction: "another" | "different_context" | "revise";
  } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [adjustingCandidateId, setAdjustingCandidateId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const candidateSignature = props.batch.candidates
    .map((candidate) => `${candidate.id}:${candidate.disposition || "active"}`)
    .join("|");
  const pages = props.feed ? 1 : Math.max(1, Math.ceil(props.batch.candidates.length / pageSize));
  const visible = useMemo(
    () => props.feed ? props.batch.candidates : props.batch.candidates.slice(page * pageSize, (page + 1) * pageSize),
    [page, props.batch.candidates, props.feed],
  );

  useEffect(() => {
    if (props.batch.kind !== "capture") return;
    setSelected(new Set(props.batch.candidates
      .filter((candidate) => (candidate.disposition || "active") === "active")
      .map((candidate) => candidate.id)));
    setPage(0);
  }, [candidateSignature, props.batch.kind, props.batch.publicId]);

  useEffect(() => { setComments({}); setAdjustingCandidateId(null); }, [props.batch.publicId]);

  const update = (id: string, patch: Partial<ReviewCandidate>) => props.onBatch({
    ...props.batch,
    candidates: props.batch.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate),
  });
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = Boolean(props.batch.candidates.length)
    && props.batch.candidates.every((candidate) => selected.has(candidate.id));
  const toggleAll = () => setSelected(allSelected
    ? new Set()
    : new Set(props.batch.candidates.map((candidate) => candidate.id)));
  const candidateSelection = (candidate: ReviewCandidate) => ({
    id: candidate.id,
    target: candidate.target,
    cue: candidate.cue,
    note: candidate.note,
    category: candidate.category,
  });
  const regenerate = async (candidateId: string, instruction: "another" | "different_context") => {
    setRegenerating({ candidateId, instruction }); setNotice("");
    try {
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/candidates/${candidateId}/regenerate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instruction }),
      });
      if (!response.ok) throw new Error("Regeneration failed");
      const data = await response.json() as { batch: ReviewBatch };
      props.onBatch(data.batch);
    } catch { setNotice("Couldn’t generate another version."); }
    finally { setRegenerating(null); }
  };
  const revise = async (candidate: ReviewCandidate) => {
    const feedback = comments[candidate.id]?.trim();
    if (!feedback || regenerating) return;
    setRegenerating({ candidateId: candidate.id, instruction: "revise" }); setNotice("");
    try {
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/candidates/${candidate.id}/revise`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback, candidate: candidateSelection(candidate) }),
      });
      if (!response.ok) throw new Error("Revision failed");
      const data = await response.json() as { batch: ReviewBatch };
      props.onBatch(data.batch);
      setComments((current) => { const next = { ...current }; delete next[candidate.id]; return next; });
      setNotice("Card revised. Review it, then keep it selected if you want to save it.");
    } catch { setNotice("Couldn’t revise this card. Your comment is still here."); }
    finally { setRegenerating(null); }
  };
  const resolveReview = async () => {
    if (!selected.size || saving) return;
    const candidates = props.batch.candidates.filter((candidate) => selected.has(candidate.id));
    const accepted = candidates.map(candidateSelection);
    setSaving(true); setNotice("");
    try {
      const endpoint = props.batch.kind === "capture" ? "resolve-capture" : "resolve";
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted, revisions: [] }),
      });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { batch: ReviewBatch; added: number };
      props.onBatch(data.batch);
      setComments({});
      setPage(0);
      setSelected(new Set(data.batch.candidates
        .filter((candidate) => (candidate.disposition || "active") === "active")
        .map((candidate) => candidate.id)));
      if (data.batch.status === "committed") {
        setNotice(`${data.added} added to Library.`);
        props.onCommitted?.(data.added);
      } else {
        setNotice(`${data.added} added · ${data.batch.candidates.length} revised ${data.batch.candidates.length === 1 ? "card" : "cards"} ready.`);
      }
    } catch { setNotice("Nothing was saved. Your comments are still here."); }
    finally { setSaving(false); }
  };
  const reset = async () => {
    if (!props.onReset || resetting) return;
    setResetting(true); setNotice("");
    try { await props.onReset(); }
    catch { setNotice("Couldn’t reset these suggestions. Try again."); }
    finally { setResetting(false); }
  };

  const commentedCount = [...selected].filter((id) => comments[id]?.trim()).length;
  const reviewTitle = props.context ? "Review cards" : props.batch.title;
  const reviewDescription = props.context
    ? props.context === "notebook" ? `${props.batch.candidates.length} proposals from Notebook` : "Nothing is saved yet"
    : props.batch.kind === "pattern_drill"
      ? "The pattern stays fixed; the meaningful slot changes."
      : props.batch.kind === "capture"
        ? "review before saving"
        : `${props.batch.candidates.length} proposals · nothing saved yet`;
  return <section className={`simple-review-batch${props.batch.kind === "capture" ? " simple-review-batch--capture" : ""}${props.feed ? " simple-review-batch--feed" : ""}`}>
    <header>{props.onDismiss ? <button aria-label={props.context === "notebook" ? "Back to Notebook" : "Back to chat"} className="simple-review-back" onClick={props.onDismiss} type="button"><ArrowLeft aria-hidden="true" size={18} /></button> : null}
      <div><strong>{reviewTitle}</strong><span>{reviewDescription}</span></div>
      <div className="simple-review-header-actions">{props.batch.kind === "capture" && !props.context ? <small>{props.batch.candidates.length} {props.batch.candidates.length === 1 ? "proposal" : "proposals"}</small> : null}
        {Boolean(props.batch.candidates.length) && props.batch.kind !== "capture" ? <button className="simple-review-bulk" onClick={toggleAll} type="button">
        {allSelected ? "Clear" : "Select all"}</button> : null}
        {!props.feed && pages > 1 ? <nav aria-label="Candidate pages"><button aria-label="Previous candidate page" disabled={page === 0} onClick={() => setPage((value) => value - 1)} type="button"><ChevronLeft aria-hidden="true" size={15} /></button>
        <span>{page + 1} / {pages}</span><button aria-label="Next candidate page" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)} type="button"><ChevronRight aria-hidden="true" size={15} /></button></nav> : null}
        {props.onReset ? <button className="simple-review-reset" disabled={saving || resetting || Boolean(regenerating)} onClick={() => void reset()} type="button">
          {resetting ? <LoaderCircle aria-hidden="true" className="simple-spin" size={14} /> : <RotateCcw aria-hidden="true" size={14} />}Reset</button> : null}
        </div>
    </header>
    {props.source}
    {!visible.length ? <p className="simple-review-empty">{props.context === "tutor"
      ? "No cards were proposed. Your chat is still here."
      : "No cards were proposed. Your source notes are still here. Reset the suggestions to edit your notes and try again."}</p> : null}
    <div className={`simple-review-list${!visible.length ? " is-empty" : ""}`}>
      {visible.map((candidate, visibleIndex) => {
        const selectionButton = <button aria-pressed={selected.has(candidate.id)} aria-label={selected.has(candidate.id) ? "Remove from selection" : "Select for Library"}
          className="simple-review-check" onClick={() => toggle(candidate.id)} type="button">
          <span aria-hidden="true">{selected.has(candidate.id) ? <Check size={14} /> : null}</span></button>;
        return <article className={`simple-review-candidate${selected.has(candidate.id) ? " is-selected" : ""}`} key={candidate.id}>
        {props.feed ? <header className="simple-review-feed-header">{selectionButton}<span>{candidate.category}</span></header> : <>
          {props.batch.kind !== "capture" ? <div className="simple-review-choice"><span>{page * pageSize + visibleIndex + 1}</span></div> : null}
          {selectionButton}</>}
        <div className="simple-review-fields">
          <p className="simple-review-focus-preview" lang={props.batch.language}>
            <FocusedText focusTerms={candidate.focusTerms} text={candidate.target} /></p>
          <p className="simple-review-cue" lang="ru">{candidate.cue}</p>
          <button aria-expanded={adjustingCandidateId === candidate.id} className="simple-review-adjust-toggle" onClick={() => {
            setAdjustingCandidateId((current) => current === candidate.id ? null : candidate.id);
          }} type="button"><Pencil aria-hidden="true" size={15} />{adjustingCandidateId === candidate.id ? "Hide adjustments" : "Adjust"}</button>
          {adjustingCandidateId === candidate.id ? <ReviewAdjustment candidate={candidate} language={props.batch.language}
            comment={comments[candidate.id] || ""} regenerating={regenerating} notice={notice}
            onClose={() => setAdjustingCandidateId(null)} onUpdate={(patch) => update(candidate.id, patch)}
            onComment={(value) => { setNotice(""); setComments((current) => ({ ...current, [candidate.id]: value }));
              if (value.trim()) setSelected((current) => new Set(current).add(candidate.id)); }}
            onRegenerate={(instruction) => regenerate(candidate.id, instruction)} onRevise={() => revise(candidate)} /> : null}
        </div>
      </article>;})}
    </div>
    {props.batch.candidates.length ? <footer><span><span className="simple-review-selected-count">{selected.size} of {props.batch.candidates.length} selected</span>
      {props.batch.kind === "capture" && props.batch.candidates.length ? <button className="simple-review-footer-clear" disabled={!selected.size} onClick={toggleAll} type="button">Clear</button> : null}
      <span aria-live="polite">{notice}</span></span><div className="simple-review-footer-actions">
      <button className="simple-primary" disabled={!selected.size || commentedCount > 0 || saving || resetting || props.batch.status === "committed"}
        onClick={() => void resolveReview()} type="button">
      {saving ? <LoaderCircle aria-hidden="true" className="simple-spin" size={15} /> : null}
      {props.batch.status === "committed" ? "Saved" : props.batch.kind === "capture"
        ? commentedCount ? `Revise ${commentedCount} first` : selected.size ? `Add ${selected.size} to Library` : "Add to Library"
        : commentedCount ? `Revise ${commentedCount} first` : `Add selected${selected.size ? ` (${selected.size})` : ""}`}</button></div></footer> : notice ? <p role="status">{notice}</p> : null}
  </section>;
}
