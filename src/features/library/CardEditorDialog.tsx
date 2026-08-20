import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { apiFetch } from "../../shared/api";
import { languageCopy } from "../../shared/config";
import type { Language, LearningItem } from "../../shared/contracts";

export function CardEditorDialog(props: {
  item: LearningItem;
  language: Language;
  onClose: () => void;
  onSaved: (item: LearningItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState(props.item.target);
  const [cue, setCue] = useState(props.item.cue);
  const [note, setNote] = useState(props.item.note);
  const [frequencyBand, setFrequencyBand] = useState(props.item.frequencyBand);
  const [feedback, setFeedback] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteNotice, setRewriteNotice] = useState("");
  const [rewriteError, setRewriteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const rewrite = async () => {
    if (!target.trim() || !cue.trim() || !feedback.trim() || rewriting || saving) return;
    setRewriting(true); setRewriteError(""); setSaveError(""); setRewriteNotice("");
    try {
      const response = await apiFetch(`/api/items/${encodeURIComponent(props.item.publicId)}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), cue: cue.trim(), note: note.trim(), feedback: feedback.trim() }),
      });
      if (!response.ok) throw new Error(response.status === 503
        ? "AI rewriting is unavailable. Your comment is still here."
        : "Could not rewrite this card. Your comment is still here.");
      const data = await response.json() as { proposal: { target: string; cue: string; note: string } };
      setTarget(data.proposal.target); setCue(data.proposal.cue); setNote(data.proposal.note);
      setFeedback(""); setRewriteNotice("Draft rewritten. Review it, then save the card.");
    } catch (nextError) {
      setRewriteError(nextError instanceof Error ? nextError.message : "Could not rewrite this card. Your comment is still here.");
    } finally { setRewriting(false); }
  };

  const save = async () => {
    if (!target.trim() || !cue.trim() || saving || rewriting) return;
    setSaving(true); setRewriteError(""); setSaveError(""); setRewriteNotice("");
    try {
      const response = await apiFetch(`/api/items/${encodeURIComponent(props.item.publicId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), cue: cue.trim(), note: note.trim(), frequencyBand }),
      });
      if (!response.ok) throw new Error("Could not save this card.");
      const data = await response.json() as { item: LearningItem };
      props.onSaved(data.item);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Could not save this card.");
      setSaving(false);
    }
  };

  return <dialog aria-labelledby="card-editor-title" className="simple-card-dialog"
    onCancel={(event) => { event.preventDefault(); props.onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }} ref={dialogRef}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="card-editor-title">Edit card</h2><span>{props.item.source || "Personal library"}</span></div>
        <button aria-label="Close editor" onClick={props.onClose} type="button"><X size={17} /></button></header>
      <div className="simple-card-dialog-fields">
        <label><span>{languageCopy[props.language].label}</span><textarea autoFocus onChange={(event) => setTarget(event.target.value)} rows={3} value={target} /></label>
        <label><span>Russian cue</span><textarea onChange={(event) => setCue(event.target.value)} rows={3} value={cue} /></label>
        <label><span>Note</span><textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
        <label><span>Frequency</span><select onChange={(event) => setFrequencyBand(event.target.value as LearningItem["frequencyBand"])} value={frequencyBand}>
          <option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
        </select></label>
        <section className="simple-card-rewrite">
          <div className="simple-card-rewrite-heading"><Sparkles size={17} /><div><strong>Rewrite with AI</strong>
            <span>Describe what feels wrong. The saved card will not change until you press Save card.</span></div></div>
          <label><span>Comment</span><textarea onChange={(event) => setFeedback(event.target.value)}
            maxLength={1000}
            placeholder="Too formal. Keep the context, but make it sound like something I would actually say."
            rows={3} value={feedback} /></label>
          <div className="simple-card-rewrite-actions"><small>Only this draft will be rewritten.</small>
            <button disabled={!target.trim() || !cue.trim() || !feedback.trim() || rewriting || saving} onClick={() => void rewrite()} type="button">
              {rewriting ? <LoaderCircle className="simple-spin" size={15} /> : <Sparkles size={15} />}
              {rewriting ? "Rewriting…" : "Rewrite draft"}</button></div>
          {rewriteNotice ? <p className="simple-card-rewrite-notice" role="status">{rewriteNotice}</p> : null}
          {rewriteError ? <p className="simple-card-dialog-error" role="alert">{rewriteError}</p> : null}
        </section>
        {saveError ? <p className="simple-card-dialog-error" role="alert">{saveError}</p> : null}
      </div>
      <footer><span /><div><button disabled={saving} onClick={props.onClose} type="button">Cancel</button>
        <button className="simple-primary" disabled={saving || rewriting || !target.trim() || !cue.trim()} type="submit">{saving ? "Saving…" : "Save card"}</button></div></footer>
    </form>
  </dialog>;
}
