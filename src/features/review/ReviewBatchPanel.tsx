import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, RotateCcw, Shuffle, WandSparkles, X } from "lucide-react";
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
};

const pageSize = 8;

export function ReviewBatchPanel(props: {
  batch: ReviewBatch;
  onBatch: (batch: ReviewBatch) => void;
  onCommitted?: (count: number) => void;
  onDismiss?: () => void;
  onReset?: () => Promise<void>;
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
  const pages = Math.max(1, Math.ceil(props.batch.candidates.length / pageSize));
  const visible = useMemo(
    () => props.batch.candidates.slice(page * pageSize, (page + 1) * pageSize),
    [page, props.batch.candidates],
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
  return <section className={`simple-review-batch${props.batch.kind === "capture" ? " simple-review-batch--capture" : ""}`}>
    <header><div><strong>{props.batch.title}</strong><span>{props.batch.kind === "pattern_drill"
      ? "The pattern stays fixed; the meaningful slot changes."
      : props.batch.kind === "capture"
        ? "review before saving"
        : `${props.batch.candidates.length} proposals · nothing saved yet`}</span></div>
      <div className="simple-review-header-actions">{props.batch.kind === "capture" ? <small>{props.batch.candidates.length} {props.batch.candidates.length === 1 ? "proposal" : "proposals"}</small> : null}
        {props.batch.candidates.length && props.batch.kind !== "capture" ? <button className="simple-review-bulk" onClick={toggleAll} type="button">
        {allSelected ? "Clear" : "Select all"}</button> : null}
        {pages > 1 ? <nav aria-label="Candidate pages"><button aria-label="Previous candidate page" disabled={page === 0} onClick={() => setPage((value) => value - 1)} type="button"><ChevronLeft size={15} /></button>
        <span>{page + 1} / {pages}</span><button aria-label="Next candidate page" disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)} type="button"><ChevronRight size={15} /></button></nav> : null}
        {props.onReset ? <button className="simple-review-reset" disabled={saving || resetting || Boolean(regenerating)} onClick={() => void reset()} type="button">
          {resetting ? <LoaderCircle className="simple-spin" size={14} /> : <RotateCcw size={14} />}Reset</button> : null}
        {props.onDismiss ? <button aria-label="Close review" onClick={props.onDismiss} type="button"><X size={16} /></button> : null}</div>
    </header>
    {!visible.length ? <p className="simple-review-empty">The source is safe, but no study cards were generated. Connect OpenAI or try a clearer sample.</p> : null}
    <div className="simple-review-list">
      {visible.map((candidate, visibleIndex) => <article className={`simple-review-candidate${selected.has(candidate.id) ? " is-selected" : ""}`} key={candidate.id}>
        {props.batch.kind !== "capture" ? <div className="simple-review-choice"><span>{page * pageSize + visibleIndex + 1}</span></div> : null}
        <button aria-label={selected.has(candidate.id) ? "Remove from selection" : "Select for Library"} className="simple-review-check" onClick={() => toggle(candidate.id)} type="button">
          <span aria-hidden="true">{selected.has(candidate.id) ? <Check size={14} /> : null}</span>
        </button>
        <div className="simple-review-fields">
          <p className="simple-review-focus-preview" lang={props.batch.language}>
            <FocusedText focusTerms={candidate.focusTerms} text={candidate.target} /></p>
          <p className="simple-review-cue" lang="ru">{candidate.cue}</p>
          <button aria-expanded={adjustingCandidateId === candidate.id} className="simple-review-adjust-toggle" onClick={() => {
            setAdjustingCandidateId((current) => current === candidate.id ? null : candidate.id);
          }} type="button"><ChevronDown aria-hidden="true" size={15} />{adjustingCandidateId === candidate.id ? "Hide adjustments" : "Adjust"}</button>
          {adjustingCandidateId === candidate.id ? <div className="simple-review-adjustment">
            <label><span>English sentence</span><textarea aria-label="Target phrase" autoComplete="off" lang={props.batch.language} name={`review-target-${candidate.id}`} onChange={(event) => update(candidate.id, { target: event.target.value })} rows={2} value={candidate.target} /></label>
            <label><span>Russian cue</span><textarea aria-label="Russian cue" autoComplete="off" lang="ru" name={`review-cue-${candidate.id}`} onChange={(event) => update(candidate.id, { cue: event.target.value })} rows={2} value={candidate.cue} /></label>
            <label><span>Topic</span><input aria-label="Category" autoComplete="off" name={`review-category-${candidate.id}`} onChange={(event) => update(candidate.id, { category: event.target.value })} value={candidate.category} /></label>
            <textarea aria-label={`Comment for card ${page * pageSize + visibleIndex + 1}`}
              autoComplete="off" className="simple-review-comment" name={`review-comment-${candidate.id}`} onChange={(event) => {
                const value = event.target.value;
                setComments((current) => ({ ...current, [candidate.id]: value }));
                if (value.trim()) setSelected((current) => new Set(current).add(candidate.id));
              }} placeholder="What should change? Leave empty if this card is OK." rows={2}
              value={comments[candidate.id] || ""} />
            <div className="simple-review-actions">
              <button disabled={Boolean(regenerating)} onClick={() => void regenerate(candidate.id, "another")} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "another"
                  ? <LoaderCircle className="simple-spin" size={13} /> : <RefreshCw size={13} />}Another</button>
              <button disabled={Boolean(regenerating)} onClick={() => void regenerate(candidate.id, "different_context")} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "different_context"
                  ? <LoaderCircle className="simple-spin" size={13} /> : <Shuffle size={13} />}Change Context</button>
              <button className="simple-review-revise" disabled={!comments[candidate.id]?.trim() || Boolean(regenerating)}
                onClick={() => void revise(candidate)} type="button">
                {regenerating?.candidateId === candidate.id && regenerating.instruction === "revise"
                  ? <LoaderCircle className="simple-spin" size={13} /> : <WandSparkles size={14} />}Revise</button>
            </div>
          </div> : null}
        </div>
      </article>)}
    </div>
    <footer><span><span className="simple-review-selected-count">{selected.size} of {props.batch.candidates.length} selected</span><span aria-live="polite">{notice}</span></span><div className="simple-review-footer-actions">
      {props.batch.kind === "capture" && props.batch.candidates.length ? <button className="simple-review-footer-clear" disabled={!selected.size} onClick={toggleAll} type="button">Clear</button> : null}
      <button className="simple-primary" disabled={!selected.size || commentedCount > 0 || saving || resetting || props.batch.status === "committed"}
        onClick={() => void resolveReview()} type="button">
      {saving ? <LoaderCircle className="simple-spin" size={15} /> : null}
      {props.batch.status === "committed" ? "Saved" : props.batch.kind === "capture"
        ? commentedCount ? `Revise ${commentedCount} first` : selected.size ? `Add ${selected.size} to Library` : "Add to Library"
        : commentedCount ? `Revise ${commentedCount} first` : `Add selected${selected.size ? ` (${selected.size})` : ""}`}</button></div></footer>
  </section>;
}
