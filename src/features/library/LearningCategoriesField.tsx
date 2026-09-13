import { useEffect, useId, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { categoryTitleKey, type CardCategoriesInput, type LearningCategorySummary } from "../../../contracts/learning-categories";
import type { Language } from "../../shared/contracts";
import { getCategories } from "./categoryRequests";

export function LearningCategoriesField({ language, value, onChange, disabled, allowCreate = true }: {
  language: Language;
  value: CardCategoriesInput;
  onChange: (value: CardCategoriesInput) => void;
  disabled?: boolean;
  allowCreate?: boolean;
}) {
  const id = useId();
  const [catalog, setCatalog] = useState<LearningCategorySummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const ids = value.learningCategoryIds || [];
  const drafts = value.newLearningCategories || [];
  const choices = [...catalog, ...drafts.filter((draft) => !catalog.some((category) => category.publicId === draft.publicId))];
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setLoaded(false);
    void getCategories(language, controller.signal).then((data) => {
      setCatalog(data.categories); setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setError("Categories could not be loaded. Your selection is kept."); });
    return () => controller.abort();
  }, [language, revision]);
  const toggle = (categoryId: string) => onChange({ ...value,
    learningCategoryIds: ids.includes(categoryId) ? ids.filter((entry) => entry !== categoryId) : [...ids, categoryId],
  });
  const duplicate = choices.find((category) => categoryTitleKey(category.title) === categoryTitleKey(title));
  const create = () => {
    if (!title.trim() || duplicate || disabled) return;
    const draft = { publicId: crypto.randomUUID(), title: title.trim(), description: description.trim() };
    onChange({ learningCategoryIds: [...ids, draft.publicId], newLearningCategories: [...drafts, draft] });
    setCreating(false); setTitle(""); setDescription(""); setQuery("");
  };
  return <section className="learning-categories-field" aria-labelledby={`${id}-label`}>
    <span id={`${id}-label`}>Learning categories</span>
    <div className="category-chips">{ids.map((categoryId) => <button className="category-chip" key={categoryId}
      disabled={disabled} onClick={() => toggle(categoryId)} type="button"
      aria-label={`Remove ${choices.find((category) => category.publicId === categoryId)?.title || "category"}`}>
      {choices.find((category) => category.publicId === categoryId)?.title || "Category"}<X size={14} aria-hidden="true" />
    </button>)}<button className="category-add" type="button" aria-expanded={open} aria-controls={`${id}-picker`}
      disabled={disabled} onClick={() => setOpen(!open)}><Plus size={16} aria-hidden="true" />Add category</button></div>
    {error ? <p className="category-error" role="alert">{error} <button type="button" onClick={() => setRevision((current) => current + 1)}>Retry</button></p> : null}
    {open ? <div className="category-picker" id={`${id}-picker`} onKeyDown={(event) => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type !== "checkbox") {
        event.preventDefault(); if (creating && event.target.type !== "search") create();
      }
    }}>
      <label><span>Find a category</span><input name={`${id}-search`} autoFocus type="search" autoComplete="off" placeholder="Search categories…"
        value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {!loaded && !error ? <p role="status">Loading categories…</p> : null}
      <div className="category-options">{choices.filter((category) => categoryTitleKey(category.title).includes(categoryTitleKey(query))).map((category) =>
        <label key={category.publicId}><input type="checkbox" checked={ids.includes(category.publicId)} disabled={disabled}
          onChange={() => toggle(category.publicId)} /><span><strong>{category.title}</strong>{category.description ? <small>{category.description}</small> : null}</span></label>)}
        {loaded && !choices.some((category) => categoryTitleKey(category.title).includes(categoryTitleKey(query))) ? <p>No matching categories.</p> : null}</div>
      {creating ? <div className="category-new">
        <label><span>Category name</span><input name={`${id}-title`} autoComplete="off" autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>Learning goal · optional</span><textarea name={`${id}-goal`} autoComplete="off" rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        {duplicate ? <p role="status">This category already exists. <button type="button" onClick={() => {
          if (!ids.includes(duplicate.publicId)) toggle(duplicate.publicId); setCreating(false);
        }}>Use {duplicate.title}</button></p> : null}
        <div className="category-picker-actions"><button type="button" onClick={() => setCreating(false)}>Cancel</button>
          <button type="button" disabled={disabled || !title.trim() || Boolean(duplicate)} onClick={create}>Add to draft</button></div>
      </div> : <div className="category-picker-actions">
        {allowCreate ? <button type="button" disabled={disabled || !loaded} onClick={() => { setTitle(query); setCreating(true); }}><Plus size={16} />New category</button> : <span />}
        <button type="button" onClick={() => setOpen(false)}><Check size={16} />Done</button>
      </div>}
      {allowCreate ? <small>New categories are created when you save the card.</small> : null}
    </div> : null}
  </section>;
}
