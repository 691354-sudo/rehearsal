import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const save = async () => {
    if (!target.trim() || !cue.trim() || saving) return;
    setSaving(true); setError("");
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
      setError(nextError instanceof Error ? nextError.message : "Could not save this card.");
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
        {error ? <p className="simple-card-dialog-error" role="alert">{error}</p> : null}
      </div>
      <footer><span /><div><button disabled={saving} onClick={props.onClose} type="button">Cancel</button>
        <button className="simple-primary" disabled={saving || !target.trim() || !cue.trim()} type="submit">{saving ? "Saving…" : "Save card"}</button></div></footer>
    </form>
  </dialog>;
}
