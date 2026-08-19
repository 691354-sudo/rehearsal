import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
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
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
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

  const update = (id: string, patch: Partial<ReviewCandidate>) => props.onBatch({
    ...props.batch,
    candidates: props.batch.candidates.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate),
  });
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const regenerate = async (candidateId: string, instruction: "another" | "different_context") => {
    setRegenerating(candidateId); setNotice("");
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
  const commit = async () => {
    if (!selected.size || saving) return;
    setSaving(true); setNotice("");
    try {
      const candidates = props.batch.candidates.filter((candidate) => selected.has(candidate.id)).map((candidate) => ({
        id: candidate.id, target: candidate.target, cue: candidate.cue,
        note: candidate.note, category: candidate.category,
      }));
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidates }),
      });
      if (!response.ok) throw new Error("Commit failed");
      const data = await response.json() as { batch: ReviewBatch; added: number };
      props.onBatch(data.batch); setSelected(new Set());
      setNotice(`${data.added} added to Library.`); props.onCommitted?.(data.added);
    } catch { setNotice("Nothing was saved. Try again."); }
    finally { setSaving(false); }
  };
  const revise = async () => {
    const nextFeedback = feedback.trim();
    if (!nextFeedback || revising) return;
    setRevising(true); setNotice("");
    try {
      const response = await apiFetch(`/api/review-batches/${props.batch.publicId}/revise`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedback: nextFeedback }),
      });
      if (!response.ok) throw new Error("Revision failed");
      const data = await response.json() as { batch: ReviewBatch };
      props.onBatch(data.batch); setFeedback(""); setNotice("Package rebuilt from your feedback.");
    } catch { setNotice("Couldn’t revise the package. Your feedback is still here."); }
    finally { setRevising(false); }
  };

  return <section className="simple-review-batch">
    <header><div><strong>{props.batch.title}</strong><span>{props.batch.candidates.length} proposals · nothing saved yet</span></div>
      {pages > 1 ? <nav aria-label="Candidate pages"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)} type="button"><ChevronLeft size={15} /></button>
        <span>{page + 1} / {pages}</span><button disabled={page >= pages - 1} onClick={() => setPage((value) => value + 1)} type="button"><ChevronRight size={15} /></button></nav> : null}
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
        </div>
        <div className="simple-review-actions">
          <button disabled={regenerating === candidate.id} onClick={() => void regenerate(candidate.id, "another")} type="button">
            {regenerating === candidate.id ? <LoaderCircle className="simple-spin" size={13} /> : <RefreshCw size={13} />}Another</button>
          <button disabled={regenerating === candidate.id} onClick={() => void regenerate(candidate.id, "different_context")} type="button">New context</button>
        </div>
      </article>)}
    </div>
    {props.batch.kind === "capture" && props.batch.status === "draft" ? <div className="simple-review-feedback">
      <label htmlFor={`capture-feedback-${props.batch.publicId}`}>Revise the whole package</label>
      <textarea id={`capture-feedback-${props.batch.publicId}`} onChange={(event) => setFeedback(event.target.value)}
        placeholder="Например: 5 слишком формальная, 7 означает другое, 9 удали" rows={3} value={feedback} />
      <button disabled={!feedback.trim() || revising} onClick={() => void revise()} type="button">
        {revising ? <LoaderCircle className="simple-spin" size={14} /> : <RefreshCw size={14} />}Revise package
      </button>
    </div> : null}
    <footer><span>{notice}</span><button className="simple-primary" disabled={!selected.size || saving || props.batch.status === "committed"} onClick={() => void commit()} type="button">
      {saving ? <LoaderCircle className="simple-spin" size={15} /> : <Check size={15} />}{props.batch.status === "committed" ? "Saved" : props.batch.kind === "capture" ? `Add all to Practice${selected.size ? ` (${selected.size})` : ""}` : `Add selected${selected.size ? ` (${selected.size})` : ""}`}</button></footer>
  </section>;
}
