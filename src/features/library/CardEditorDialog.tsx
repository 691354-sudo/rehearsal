import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { apiFetch } from "../../shared/api";
import { languageCopy } from "../../shared/config";
import type { Language, LearningItem } from "../../shared/contracts";
import type { AppRoute } from "../../lib/appRoute";
import { focusTermsInTarget } from "../../../contracts/text";

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
  const [focusPhrase, setFocusPhrase] = useState(props.item.focusTerms[0] || "");
  const [frequencyBand, setFrequencyBand] = useState(props.item.frequencyBand);
  const [feedback, setFeedback] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteNotice, setRewriteNotice] = useState("");
  const [rewriteError, setRewriteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const allowNavigationRef = useRef(false);
  const dirty = target !== props.item.target || cue !== props.item.cue || note !== props.item.note
    || focusPhrase !== (props.item.focusTerms[0] || "")
    || frequencyBand !== props.item.frequencyBand || Boolean(feedback.trim());
  const focusTerms = focusPhrase.trim() ? [focusPhrase.trim(), ...props.item.focusTerms.slice(1)] : [];
  const focusValid = focusTermsInTarget(target, focusTerms);
  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes to this card?")) return;
    allowNavigationRef.current = true;
    props.onClose();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: Event) => {
      const next = (event as CustomEvent<{ route: AppRoute }>).detail?.route;
      if (next?.section === "library" && next.language === props.language && next.edit === props.item.publicId) return;
      if (allowNavigationRef.current || window.confirm("Discard unsaved changes to this card?")) return;
      event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("app-before-navigate", warn);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("app-before-navigate", warn);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [dirty]);

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
    if (!target.trim() || !cue.trim() || !focusValid || saving || rewriting) return;
    setSaving(true); setRewriteError(""); setSaveError(""); setRewriteNotice("");
    try {
      const response = await apiFetch(`/api/items/${encodeURIComponent(props.item.publicId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), cue: cue.trim(), note: note.trim(), frequencyBand,
          focusTerms }),
      });
      if (!response.ok) throw new Error("Could not save this card.");
      const data = await response.json() as { item: LearningItem };
      allowNavigationRef.current = true;
      props.onSaved(data.item);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Could not save this card.");
      setSaving(false);
    }
  };

  return <dialog aria-labelledby="card-editor-title" className="simple-card-dialog"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }} ref={dialogRef}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="card-editor-title">Edit card</h2><span>{props.item.source || "Personal library"}</span></div>
        <button aria-label="Close editor" onClick={requestClose} type="button"><X size={17} /></button></header>
      <div className="simple-card-dialog-fields">
        <label><span>{languageCopy[props.language].label}</span><textarea autoComplete="off" lang={props.language} name="card-target" onChange={(event) => setTarget(event.target.value)} rows={3} value={target} /></label>
        <label><span>Russian cue</span><textarea autoComplete="off" lang="ru" name="card-cue" onChange={(event) => setCue(event.target.value)} rows={3} value={cue} /></label>
        <label><span>Focus phrase</span><input aria-describedby="card-focus-help" autoComplete="off" name="card-focus"
          onChange={(event) => setFocusPhrase(event.target.value)} value={focusPhrase} />
          <small id="card-focus-help">Optional · must appear exactly in the target phrase.</small>
          {!focusValid ? <em className="simple-card-dialog-error">Focus phrase isn’t present in the target.</em> : null}</label>
        <label><span>Note</span><textarea autoComplete="off" name="card-note" onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
        <label><span>Frequency</span><select name="card-frequency" onChange={(event) => setFrequencyBand(event.target.value as LearningItem["frequencyBand"])} value={frequencyBand}>
          <option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
        </select></label>
        <section className="simple-card-rewrite">
          <div className="simple-card-rewrite-heading"><Sparkles size={17} /><div><strong>AI rewrite</strong></div></div>
          <label><span>What should change?</span><textarea autoComplete="off" name="rewrite-feedback" onChange={(event) => setFeedback(event.target.value)}
            maxLength={1000}
            placeholder="e.g. Less formal…"
            rows={2} value={feedback} /></label>
          <div className="simple-card-rewrite-actions"><small>Doesn’t save automatically.</small>
            <button disabled={!target.trim() || !cue.trim() || !feedback.trim() || rewriting || saving} onClick={() => void rewrite()} type="button">
              {rewriting ? <LoaderCircle className="simple-spin" size={15} /> : <Sparkles size={15} />}
              {rewriting ? "Rewriting…" : "Rewrite"}</button></div>
          {rewriteNotice ? <p className="simple-card-rewrite-notice" role="status">{rewriteNotice}</p> : null}
          {rewriteError ? <p className="simple-card-dialog-error" role="alert">{rewriteError}</p> : null}
        </section>
        {saveError ? <p className="simple-card-dialog-error" role="alert">{saveError}</p> : null}
      </div>
      <footer><span /><div><button disabled={saving} onClick={requestClose} type="button">Cancel</button>
        <button className="simple-primary" disabled={saving || rewriting || !target.trim() || !cue.trim() || !focusValid} type="submit">{saving ? "Saving…" : "Save card"}</button></div></footer>
    </form>
  </dialog>;
}
