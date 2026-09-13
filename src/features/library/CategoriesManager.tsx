import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import type { LearningCategory, LearningCategorySummary } from "../../../contracts/learning-categories";
import { AppLink } from "../../app/AppLink";
import { defaultPracticeRoute } from "../../lib/appRoute";
import type { Language, LearningItem } from "../../shared/contracts";
import { addCardsToCategories, getCategories, getCategory, writeCategory } from "./categoryRequests";
import { getTopic, getTopics } from "./topicRequests";
import { deleteCard } from "./deleteCard";
import { TopicCards } from "./TopicCards";

export function CategoriesManager({ language, categoryId, onCategory, onEdit, onItemDeleted, onChanged }: {
  language: Language; categoryId?: string; onCategory: (id?: string) => void;
  onEdit: (item: LearningItem) => void; onItemDeleted: (id: string) => void; onChanged: () => void;
}) {
  const [categories, setCategories] = useState<LearningCategorySummary[]>([]);
  const [category, setCategory] = useState<LearningCategory | null>(null);
  const [screen, setScreen] = useState<"list" | "detail" | "create" | "edit" | "add">(categoryId ? "detail" : "list");
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState(""); const [limit, setLimit] = useState(20);
  const [allItems, setAllItems] = useState<LearningItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [selecting, setSelecting] = useState(false);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0); const allowNavigation = useRef(false); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void Promise.all([getCategories(language, controller.signal), categoryId ? getCategory(categoryId, controller.signal) : null])
      .then(([data, detail]) => { if (!controller.signal.aborted) { setCategories(data.categories); setCategory(detail); setScreen(detail ? "detail" : "list"); } })
      .catch(() => { if (!controller.signal.aborted) setError("Categories could not be loaded. Retry to continue."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [language, categoryId, retry]);
  const nameDirty = screen === "create" ? Boolean(title || description) : screen === "edit" && (title !== category?.title || description !== category?.description);
  useEffect(() => {
    if (!nameDirty) return;
    const warn = (event: Event) => { if (!allowNavigation.current && !window.confirm("Discard the unsaved category changes?")) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("app-before-navigate", warn); window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("app-before-navigate", warn); window.removeEventListener("beforeunload", unload); };
  }, [nameDirty]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); setQuery(""); setLimit(20); }, [screen, categoryId]);
  const toggle = (id: string) => setSelected((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const back = () => {
    if (saving) return;
    if ((screen === "create" && (title || description) || screen === "edit" && (title !== category?.title || description !== category?.description))
      && !window.confirm("Discard the unsaved category changes?")) return;
    allowNavigation.current = true;
    setSelecting(false); setSelected(new Set()); setError("");
    if (screen === "detail" || screen === "create") { setScreen("list"); onCategory(undefined); } else setScreen("detail");
  };
  const finish = async (message: string) => {
    setNotice(message); setSelecting(false); setSelected(new Set()); setScreen("detail"); onChanged();
    try { const [data, detail] = await Promise.all([getCategories(language), categoryId ? getCategory(categoryId) : null]); setCategories(data.categories); setCategory(detail); }
    catch { setError("Change saved. Retry to refresh the list."); }
  };
  const saveName = async () => {
    if (!title.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const data = await writeCategory(screen === "edit" ? `/${categoryId}` : "", screen === "edit" ? "PATCH" : "POST",
        { language, publicId: draftId, title: title.trim(), description: description.trim() });
      allowNavigation.current = true; setCategory(data.category); setScreen("detail"); onCategory(data.category.publicId); setRetry((value) => value + 1); onChanged();
    } catch (caught) { setError((caught as Error).message); } finally { setSaving(false); }
  };
  const removeCategory = async () => {
    if (!category || saving || !window.confirm(`Delete “${category.title}”? All cards and their review history will stay in Library.`)) return;
    setSaving(true); setError("");
    try { await writeCategory(`/${category.publicId}`, "DELETE"); setCategory(null); setScreen("list"); onCategory(undefined); setRetry((value) => value + 1); onChanged(); }
    catch (caught) { setError((caught as Error).message); } finally { setSaving(false); }
  };
  const startAdd = async () => {
    setScreen("add"); setSelected(new Set()); setLoading(true); setError("");
    try {
      const topics = await getTopics(language);
      const collections = await Promise.all(topics.filter((topic) => topic.publicId !== "liked").map((topic) => getTopic(topic.publicId)));
      setAllItems([...new Map(collections.flatMap((topic) => topic.items).map((item) => [item.publicId, item])).values()]);
    } catch { setError("Library cards could not be loaded. Retry to continue."); } finally { setLoading(false); }
  };
  const saveCards = async (remove: boolean) => {
    if (!category || !selected.size || saving) return;
    setSaving(true); setError("");
    try {
      if (remove) await writeCategory(`/${category.publicId}/cards`, "DELETE", { itemIds: [...selected] });
      else await addCardsToCategories(language, [category.publicId], [...selected]);
      await finish(remove ? "Removed from this category. Cards stay in Library." : "Cards added to this category.");
    } catch (caught) { setError((caught as Error).message); } finally { setSaving(false); }
  };
  const removeCard = async (id: string) => {
    setSaving(true); setError("");
    try { if (await deleteCard(id)) { onItemDeleted(id); await finish("Card deleted."); } }
    catch (caught) { setError((caught as Error).message); } finally { setSaving(false); }
  };
  const list = (screen === "add" ? allItems.filter((item) => !category?.items.some((entry) => entry.publicId === item.publicId)) : category?.items || [])
    .filter((item) => `${item.target} ${item.cue}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <section className="categories-manager topics-flow" aria-busy={saving || loading}>
    <header className="topics-flow-header">{screen !== "list" ? <button className="topic-icon" aria-label="Back to categories" type="button" disabled={saving} onClick={back}><ArrowLeft size={18} /></button> : null}
      <h2 ref={heading} tabIndex={-1}>{screen === "list" ? "Categories" : screen === "create" ? "New category" : screen === "edit" ? "Edit category" : screen === "add" ? "Add from Library" : category?.title || "Category"}</h2>
      {screen === "list" ? <button className="topic-icon" aria-label="New category" disabled={loading || saving} type="button" onClick={() => { setTitle(""); setDescription(""); setDraftId(crypto.randomUUID()); allowNavigation.current = false; setScreen("create"); }}><Plus size={18} /></button> : null}
      {screen === "detail" && category ? <details className="topic-actions"><summary aria-label="Category actions"><MoreHorizontal size={18} /></summary>
        <div onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")!.open = false; }}>
          <button disabled={saving} type="button" onClick={() => { setTitle(category.title); setDescription(category.description); allowNavigation.current = false; setScreen("edit"); }}>Edit name &amp; goal</button>
          <button disabled={saving} className="topic-danger" type="button" onClick={() => void removeCategory()}>Delete category</button>
        </div></details> : null}
    </header>
    {error ? <p className="category-error" role="alert">{error} <button disabled={saving} type="button" onClick={() => screen === "create" || screen === "edit" ? void saveName() : screen === "add" && selected.size ? void saveCards(false) : selecting && selected.size ? void saveCards(true) : screen === "add" ? void startAdd() : setRetry((value) => value + 1)}>Retry</button></p> : null}
    {notice ? <p className="topic-feedback" role="status">{notice}</p> : null}
    {loading ? <p role="status">Loading…</p> : <div className="topics-flow-body">
      {screen === "list" ? <><label className="topic-search"><span>Search categories</span><input name="category-search" autoComplete="off" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories…" /></label>
        <ul className="category-browser">{categories.filter((entry) => entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((entry) => <li key={entry.publicId}>
          <button type="button" onClick={() => { setNotice(""); onCategory(entry.publicId); }}><strong>{entry.title}</strong><span>{entry.itemCount}</span><ChevronRight size={16} /></button>
        </li>)}</ul>{!categories.length ? <p className="topic-empty">Create a category for what you want to practise, such as Phrasal verbs.</p> : null}</> : null}
      {screen === "create" || screen === "edit" ? <form className="category-name-form" onSubmit={(event) => { event.preventDefault(); void saveName(); }}>
        <label><span>Category name</span><input name="category-title" autoComplete="off" autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label><span>Learning goal · optional</span><textarea name="category-goal" autoComplete="off" rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <button className="simple-primary" type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save category"}</button>
      </form> : null}
      {screen === "detail" && category ? <>{category.description ? <p className="topic-meta">{category.description}</p> : null}
        <div className="topic-toolbar">{selecting ? <><span>{selected.size} selected</span><button type="button" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Cancel</button></> : <>
          <button type="button" onClick={() => void startAdd()}><Plus size={16} />Add cards</button><button type="button" disabled={!category.items.length} onClick={() => setSelecting(true)}>Select</button>
          <AppLink route={{ ...defaultPracticeRoute(language), category: category.publicId }}>Practise</AppLink></>}</div></> : null}
      {screen === "detail" || screen === "add" ? <>
        <label className="topic-search"><span>Search cards</span><input name="category-search" autoComplete="off" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} /></label>
        <TopicCards items={list.slice(0, limit)} language={language} selected={selecting || screen === "add" ? selected : undefined} onToggle={toggle}
          onEdit={(id) => { const item = list.find((entry) => entry.publicId === id); if (item) onEdit(item); }} onDelete={(id) => void removeCard(id)} disabled={saving} />
        {!list.length ? <p className="topic-empty">{query ? "No matching cards." : screen === "add" ? "All Library cards are already in this category." : "No cards yet. Add some from Library."}</p> : null}
        {limit < list.length ? <button type="button" onClick={() => setLimit((value) => value + 20)}>Show 20 more</button> : null}
        {selecting || screen === "add" ? <footer className="topics-flow-footer"><span>{selected.size} selected</span>
          <button className="simple-primary" type="button" disabled={saving || !selected.size} onClick={() => void saveCards(screen !== "add")}>{saving ? "Saving…" : screen === "add" ? "Add to category" : "Remove from category"}</button></footer> : null}
      </> : null}
    </div>}
  </section>;
}
