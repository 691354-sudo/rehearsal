import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CardCategoriesInput } from "../../../contracts/learning-categories";
import type { Language } from "../../shared/contracts";
import { LearningCategoriesField } from "./LearningCategoriesField";
import { addCardsToCategories } from "./categoryRequests";

export function AddToCategoriesDialog({ language, itemIds, onClose, onSaved }: {
  language: Language; itemIds: string[]; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<CardCategoriesInput>({ learningCategoryIds: [] });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const save = async () => {
    if (!selection.learningCategoryIds?.length || saving) return;
    setSaving(true); setError("");
    try { await addCardsToCategories(language, selection.learningCategoryIds, itemIds); onSaved(); }
    catch (caught) { setError((caught as Error).message); setSaving(false); }
  };
  return <dialog className="simple-card-dialog" ref={dialog} aria-labelledby="bulk-categories-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="bulk-categories-title">Add to categories</h2><span>{itemIds.length} cards · existing categories are kept</span></div>
        <button type="button" aria-label="Close categories" disabled={saving} onClick={onClose}><X size={18} /></button></header>
      <div className="simple-card-dialog-fields"><LearningCategoriesField language={language} value={selection} onChange={setSelection} disabled={saving} allowCreate={false} />
        {error ? <p className="category-error" role="alert">{error}</p> : null}</div>
      <footer><span /><div><button type="button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="simple-primary"
        disabled={saving || !selection.learningCategoryIds?.length || itemIds.length > 500}>{saving ? "Saving…" : "Add cards"}</button></div></footer>
    </form>
  </dialog>;
}
