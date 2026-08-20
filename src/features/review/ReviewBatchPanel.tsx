import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, RotateCcw, Shuffle, X } from "lucide-react";
import { apiFetch } from "../../shared/api";

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
  title: string;
  kind: "chat_review" | "vocab" | "text_import" | "pattern_drill" | "capture";
  candidates: ReviewCandidate[];
  status: "draft" | "committed";
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
  const [regenerating, setRegenerating] = useState<{ candidateId: string; instruction: "another" | "different_context" } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
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

  useEffect(() => setComments({}), [props.batch.publicId]);

  const update = (id: string, patch: Partial<ReviewCandidate>) => props.onBatch({
    ...props.batch,
    candidates: props.batch.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate),
  });
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
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
  const resolveReview = async () => {
    if (!selected.size || saving) return;
    const candidates = props.batch.candidates.filter((candidate) => selected.has(candidate.id));
    const accepted = candidates.filter((candidate) => !comments[candidate.id]?.trim()).map(candidateSelection);
    const revisions = candidates.filter((candidate) => comments[candidate.id]?.trim()).map((candidate) => ({
      ...candidateSelection(candidate),
      feedback: comments[candidate.id].trim(),
    }));
    setSaving(true); setNotice("");
    try {
      const endpoint = props.batch.kind === "capture" ? "resolve-capture" : "resolve";
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/${endpoint}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accepted, revisions }),
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
  const acceptedCount = selected.size - commentedCount;

  return <section className="simple-review-batch">
    <header><div><strong>{props.batch.title}</strong><span>{props.batch.kind === "pattern_drill"
      ? "The pattern stays fixed; the meaningful slot changes."
      : props.batch.kind === "capture"
        ? `${props.batch.candidates.length} proposals · review before saving`
        : `${props.batch.candidates.length} proposals · nothing saved yet`}</span></div>
      <div className="simple-review-header-actions">{pages > 1 ? <nav aria-label="Candidate pages"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)} type="button"><ChevronLeft size={15} /></button>
        <span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)} type="button"><ChevronRight size={15} /></button></nav> : null}
        {props.onReset ? <button className="simple-review-reset" disabled={saving || resetting || Boolean(regenerating)} onClick={() => void reset()} type="button">
          {resetting ? <LoaderCircle className="simple-spin" size={14} /> : <RotateCcw size={14} />}Reset</button> : null}
        {props.onDismiss ? <button aria-label="Close review" onClick={props.onDismiss} type="button"><X size={16} /></button> : null}</div>
    </header>
    {!visible.length ? <p className="simple-review-empty">The source is safe, but no study cards were generated. Connect OpenAI or try a clearer sample.</p> : null}
    <div className="simple-review-list">
      {visible.map((candidate, visibleIndex) => <article className={`simple-review-candidate${selected.has(candidate.id) ? " is-selected" : ""}`} key={candidate.id}>
        <div className="simple-review-choice"><span>{page * pageSize + visibleIndex + 1}</span>
          <button aria-label={selected.has(candidate.id) ? "Remove from selection" : "Select for Library"} className="simple-review-check" onClick={() => toggle(candidate.id)} type="button">
            {selected.has(candidate.id) ? <Check size={14} /> : null}
          </button>
        </div>
        <div className="simple-review-fields">
          <input aria-label="Target phrase" onChange={(event) => update(candidate.id, { target: event.target.value })} value={candidate.target} />
          <input aria-label="Russian cue" className="is-cue" onChange={(event) => update(candidate.id, { cue: event.target.value })} value={candidate.cue} />
          <div className="simple-review-meta"><input aria-label="Category" onChange={(event) => update(candidate.id, { category: event.target.value })} value={candidate.category} />
            <span>{candidate.disposition || "active"}</span><span>{candidate.frequencyBand}</span><span>{candidate.currency}</span></div>
          <textarea aria-label={`Comment for card ${page * pageSize + visibleIndex + 1}`}
            className="simple-review-comment" onChange={(event) => {
              const value = event.target.value;
              setComments((current) => ({ ...current, [candidate.id]: value }));
              if (value.trim()) setSelected((current) => new Set(current).add(candidate.id));
            }} placeholder="What should change? Leave empty if this card is OK." rows={2}
            value={comments[candidate.id] || ""} />
        </div>
        <div className="simple-review-actions">
          <button disabled={regenerating?.candidateId === candidate.id} onClick={() => void regenerate(candidate.id, "another")} type="button">
            {regenerating?.candidateId === candidate.id && regenerating.instruction === "another"
              ? <LoaderCircle className="simple-spin" size={13} /> : <RefreshCw size={13} />}Another</button>
          <button disabled={regenerating?.candidateId === candidate.id} onClick={() => void regenerate(candidate.id, "different_context")} type="button">
            {regenerating?.candidateId === candidate.id && regenerating.instruction === "different_context"
              ? <LoaderCircle className="simple-spin" size={13} /> : <Shuffle size={13} />}Change Context</button>
        </div>
      </article>)}
    </div>
    <footer><span>{notice}</span><button className="simple-primary" disabled={!selected.size || saving || resetting || props.batch.status === "committed"}
      onClick={() => void resolveReview()} type="button">
      {saving ? <LoaderCircle className="simple-spin" size={15} /> : commentedCount ? <RefreshCw size={15} /> : <Check size={15} />}
      {props.batch.status === "committed" ? "Saved" : props.batch.kind === "capture"
        ? commentedCount ? `Revise ${commentedCount} · Add ${acceptedCount}` : `Add to Library${selected.size ? ` (${selected.size})` : ""}`
        : commentedCount ? `Revise ${commentedCount} · Add ${acceptedCount}` : `Add selected${selected.size ? ` (${selected.size})` : ""}`}</button></footer>
  </section>;
}
