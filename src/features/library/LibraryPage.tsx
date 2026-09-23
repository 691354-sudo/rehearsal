import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { CardEditorDialog } from "./CardEditorDialog";
import { CardCreateDialog } from "./CardCreateDialog";
import { getCategories } from "./categoryRequests";
import { getTopic, getTopics } from "./topicRequests";
import { CardActions } from "./CardActions";
import { CategoriesManager } from "./CategoriesManager";
import { AddToCategoriesDialog } from "./AddToCategoriesDialog";
import { deleteCard } from "./deleteCard";
import { TopicsManager } from "./TopicsManager";
import { apiFetch } from "../../shared/api";
import type { IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import { filterLibraryItems, type LibrarySort, type LibraryStatus } from "../../lib/libraryView";
import type { AppRoute, HistoryMode, LibraryRoute } from "../../lib/appRoute";
import { FocusedText } from "../progress/FocusedText";
import { CardSources } from "../progress/CardSources";

export function LibraryPage({ items, language, route, onRoute, onItemDeleted, onItemUpdated, onItemsReload, onListen, onListened, onPlay, onPracticeEnabled, onReview }: {
  items: LearningItem[];
  language: Language;
  route: LibraryRoute;
  onRoute: (route: LibraryRoute, historyMode?: HistoryMode) => void;
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: (item: LearningItem) => void;
  onItemsReload: () => Promise<boolean>;
  onListen: () => void;
  onListened: (itemId: string) => Promise<void>;
  onPlay: (text: string) => Promise<unknown>;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onReview: (itemId: string) => void;
}) {
  const [searchInput, setSearchInput] = useState(route.query);
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [categories, setCategories] = useState<IslandSummary[]>([]);
  const [collectionItems, setCollectionItems] = useState<LearningItem[]>([]);
  const [topicItemIds, setTopicItemIds] = useState<string[]>([]);
  const [topicsError, setTopicsError] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [added, setAdded] = useState(false);
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [topicsRevision, setTopicsRevision] = useState(0);
  const allowDirtyNavigationRef = useRef(false);
  const [bulkCategories, setBulkCategories] = useState(false);
  const [categoryEditingItem, setCategoryEditingItem] = useState<LearningItem | null>(null);
  const showTopics = route.view !== "cards";
  const showImport = route.panel === "import";
  const showCreate = route.panel === "create";
  const editingItem = route.edit ? [...collectionItems, ...(categoryEditingItem ? [categoryEditingItem] : []), ...items].find((item) => item.publicId === route.edit) || null : null;
  const visibleCount = route.page * 20;
  const { query, status, sort, topic } = route;
  const patchRoute = (patch: Partial<LibraryRoute>, historyMode: HistoryMode = "replace") => onRoute({ ...route, ...patch }, historyMode);
  const closeSurface = (surface: "import" | "create" | "editor", patch: Partial<LibraryRoute>) => {
    if (window.history.state?.surface === surface) {
      window.history.back();
      return;
    }
    patchRoute(patch, "replace");
  };

  useEffect(() => setSearchInput(route.query), [route.query]);
  useEffect(() => {
    if (searchInput === route.query) return;
    const timeout = window.setTimeout(() => patchRoute({ query: searchInput, page: 1 }), 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput, route.query]);
  useEffect(() => {
    if (!title.trim() && !text.trim()) return;
    const warn = (event: Event) => {
      const next = (event as CustomEvent<{ route: AppRoute }>).detail?.route;
      if (next?.section === "library" && next.language === language && next.panel === "import") return;
      if (allowDirtyNavigationRef.current || window.confirm("Discard this unfinished import?")) return;
      event.preventDefault();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("app-before-navigate", warn);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("app-before-navigate", warn);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [text, title]);
  const loadTopics = (nextLanguage = language) => getTopics(nextLanguage);
  const loadTopicItemIds = async (topicId: string) => {
    const data = await getTopic(topicId, undefined, language);
    setCollectionItems(data.items);
    return data.items.map((item) => item.publicId);
  };
  const refreshTopics = async () => {
    try {
      const [loadedTopics, loadedItemIds, catalog] = await Promise.all([
        loadTopics(),
        topic === "all" ? Promise.resolve([]) : loadTopicItemIds(topic),
        getCategories(language),
      ]);
      setTopics(loadedTopics);
      setCategories(catalog.categories.map((category) => ({ ...category, publicId: `category:${category.publicId}` })));
      if (topic !== "all") setTopicItemIds(loadedItemIds);
      setTopicsError(false);
    } catch {
      setTopicsError(true);
    }
  };

  useEffect(() => {
    let active = true;
    setCollectionItems([]); setTopicItemIds([]); setBatch(null); setAdded(false); setSelectedItemIds(new Set());
    setTopics([]); setCategories([]); setTopicsError(false);
    void Promise.all([loadTopics(language), getCategories(language)]).then(([loadedTopics, catalog]) => {
      if (!active) return;
      setTopics(loadedTopics);
      setCategories(catalog.categories.map((category) => ({ ...category, publicId: `category:${category.publicId}` })));
    }).catch(() => {
      if (active) setTopicsError(true);
    });
    return () => { active = false; };
  }, [language]);
  useEffect(() => {
    let active = true;
    if (topic !== "all" && topic !== "liked") void getCategories(language).then((catalog) => {
      if (active && catalog.redirects[topic]) patchRoute({ view: "categories", topic: "all", category: catalog.redirects[topic] }, "replace");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [language, topic, topicsRevision]);
  useEffect(() => {
    if (topic === "all") { setTopicItemIds([]); return; }
    let active = true;
    void loadTopicItemIds(topic).then((loadedItemIds) => {
      if (active) {
        setTopicItemIds(loadedItemIds);
        setTopicsError(false);
      }
    }).catch(() => {
      if (active) { setTopicItemIds([]); setTopicsError(true); }
    });
    return () => { active = false; };
  }, [topic]);
  useEffect(() => {
    const itemIds = new Set(items.map((item) => item.publicId));
    setSelectedItemIds((current) => new Set([...current].filter((itemId) => itemIds.has(itemId))));
  }, [items]);

  const importText = async () => {
    if (!text.trim() || importing) return;
    setImporting(true); setNotice(""); setBatch(null); setAdded(false);
    try {
      const delimited = text.includes("$");
      if (delimited && !title.trim()) { setNotice("Add a Topic title for this $ import."); return; }
      const response = await apiFetch("/api/import/text", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, title: title.trim() || "Imported text", text }) });
      if (!response.ok) throw new Error("Import failed");
      const data = await response.json() as { batch: ReviewBatch };
      allowDirtyNavigationRef.current = true;
      setBatch(data.batch); setTitle(""); setText(""); patchRoute({ panel: null }, "replace");
      allowDirtyNavigationRef.current = false;
    } catch { setNotice("Import failed. Nothing was added to Library."); }
    finally { setImporting(false); }
  };
  const itemDeleted = (itemId: string) => {
    onItemDeleted(itemId); setCollectionItems((before) => before.filter((item) => item.publicId !== itemId));
    setSelectedItemIds((before) => { const next = new Set(before); next.delete(itemId); return next; });
    void refreshTopics();
  };
  const deleteItem = async (itemId: string) => {
    setNotice("");
    try { if (await deleteCard(itemId)) itemDeleted(itemId); }
    catch (caught) { setNotice((caught as Error).message); }
  };
  const setPracticeEnabled = async (itemId: string, practiceEnabled: boolean) => {
    if (!await onPracticeEnabled(itemId, practiceEnabled)) { setNotice("Couldn’t update this card."); return; }
    setNotice(practiceEnabled ? "Returned to learning." : "Moved to Learned.");
  };
  const patternDrill = async (itemId: string) => {
    setNotice("Preparing pattern variants…"); setBatch(null); setAdded(false);
    try {
      const response = await apiFetch(`/api/items/${itemId}/pattern-drill`, { method: "POST" });
      if (!response.ok) throw new Error("Pattern failed");
      const data = await response.json() as { batch: ReviewBatch };
      setBatch(data.batch); setNotice("");
    } catch { setNotice("Couldn’t prepare pattern variants."); }
  };
  const topicItemSet = useMemo(() => new Set(topicItemIds), [topicItemIds]);
  const delimitedImport = text.includes("$");
  const importFragmentCount = delimitedImport ? text.split("$").filter((fragment) => fragment.trim()).length : 0;
  const visibleItems = useMemo(() => filterLibraryItems(topic !== "all" ? collectionItems : items, {
    query, status, sort, topicItemIds: topic === "all" ? null : topicItemSet, language,
  }), [items, collectionItems, language, query, sort, status, topic, topicItemSet]);
  const displayedItems = visibleItems.slice(0, visibleCount);
  const selectedVisibleCount = displayedItems.filter((item) => selectedItemIds.has(item.publicId)).length;
  const allVisibleSelected = Boolean(displayedItems.length) && selectedVisibleCount === displayedItems.length;
  const toggleItem = (itemId: string) => setSelectedItemIds((current) => {
    const next = new Set(current);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });
  const toggleVisible = () => setSelectedItemIds((current) => {
    const next = new Set(current);
    displayedItems.forEach((item) => { if (allVisibleSelected) next.delete(item.publicId); else next.add(item.publicId); });
    return next;
  });

  const deleteSelected = async () => {
    const itemIds = [...selectedItemIds];
    if (!itemIds.length || deletingSelected) return;
    const noun = itemIds.length === 1 ? "card" : "cards";
    if (!window.confirm(`Delete ${itemIds.length} selected ${noun} from Library?`)) return;
    setDeletingSelected(true); setNotice("");
    try {
      const response = await apiFetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      if (!response.ok) throw new Error("Bulk delete failed");
      const data = await response.json() as { deleted: string[] };
      data.deleted.forEach(onItemDeleted);
      setCollectionItems((before) => before.filter((item) => !data.deleted.includes(item.publicId))); void refreshTopics();
      setSelectedItemIds(new Set());
      setSelectionMode(false);
      setNotice(`${data.deleted.length} ${data.deleted.length === 1 ? "card" : "cards"} deleted.`);
    } catch {
      const reloaded = await onItemsReload();
      setNotice(reloaded
        ? "The deletion result was unclear, so Library was reloaded. Check the remaining selection before trying again."
        : "Couldn’t confirm the bulk deletion. Reconnect and reload Library before trying again.");
    }
    finally { setDeletingSelected(false); }
  };

  const managementActions = <>
        <button onClick={() => patchRoute({ view: showTopics ? "cards" : "topics", panel: null, edit: null }, "push")} type="button">{showTopics ? "Back to cards" : "Topics & categories"}</button>
        {!showTopics ? <button onClick={() => showImport ? closeSurface("import", { panel: null }) : patchRoute({ panel: "import", edit: null }, "push")} type="button">{showImport ? "Close import" : "Import text"}</button> : null}
  </>;

  return <main className="simple-main" id="main-content"><header className="simple-page-heading"><div><h1>Library</h1><p>{items.length} cards</p></div>
    <div className="simple-library-heading-actions"><div className="simple-library-desktop-actions">{managementActions}</div>
      <button aria-label="Add card" className="simple-add-card" onClick={() => patchRoute({ panel: "create", edit: null }, "push")} type="button"><Plus size={18} /><span>Add card</span></button>
      <details className="simple-library-management" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}><summary aria-label="Library options"><MoreHorizontal aria-hidden="true" size={18} /></summary><div>
        {managementActions}
      </div></details></div></header>
    {topicsError ? <div className="simple-unavailable" role="alert"><span>Topics unavailable. Your cards are still here.</span><button onClick={() => void refreshTopics()} type="button"><RefreshCw size={14} />Retry</button></div> : null}
    {showTopics ? <div className="simple-library-secondary"><nav className="collection-tabs" aria-label="Topics and categories">
      <button type="button" aria-current={route.view === "topics" ? "page" : undefined} onClick={() => patchRoute({ view: "topics", category: undefined, topic: "all", edit: null })}>Topics</button>
      <button type="button" aria-current={route.view === "categories" ? "page" : undefined} onClick={() => patchRoute({ view: "categories", topic: "all", category: undefined, edit: null })}>Categories</button></nav>
      {route.view === "categories" ? <CategoriesManager language={language} categoryId={route.category} key={`${language}:${topicsRevision}`}
        onCategory={(category) => patchRoute({ category })} onEdit={(item) => { setCategoryEditingItem(item); patchRoute({ edit: item.publicId }, "push"); }}
        onItemDeleted={itemDeleted} onChanged={() => { void onItemsReload(); void refreshTopics(); }} /> : <TopicsManager initialTopicId={route.topic === "all" ? "" : route.topic} key={`${language}:${topicsRevision}`} language={language}
      onClose={() => { patchRoute({ view: "cards" }, "replace"); void refreshTopics(); }}
      onCreateNew={() => patchRoute({ panel: "create", edit: null }, "push")}
      onEdit={(itemId) => patchRoute({ edit: itemId }, "push")}
      onItemDeleted={itemDeleted}
      onTopic={(topicId) => patchRoute({ topic: topicId || "all" }, "replace")} />}</div> : <>
      {showImport ? <section className="simple-import-card simple-library-secondary">
      <div className="simple-section-heading"><FilePlus2 size={19} /><div><strong>Import text or transcript</strong></div></div>
      <label className="simple-field-label"><span>Title or source</span><input autoComplete="off" name="import-title" onChange={(event) => setTitle(event.target.value)} placeholder="For example: August conversation…" value={title} /></label>
      <label className="simple-file-button"><Upload size={16} />Upload .txt<input accept=".txt,text/plain" name="import-file" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return; setTitle(file.name.replace(/\.txt$/i, "")); setText(await file.text());
      }} type="file" /></label>
      <label className="simple-field-label"><span>Text or transcript</span><textarea autoComplete="off" name="import-text" onChange={(event) => setText(event.target.value)} placeholder="Paste text or transcript…" rows={7} value={text} /></label>
      {delimitedImport ? <p className="simple-import-notice">{importFragmentCount} card fragments · each `$` starts a new card · all selected cards will go to one Topic.</p> : null}
      <div className="simple-library-panel-actions"><button onClick={() => {
        if ((title.trim() || text.trim()) && !window.confirm("Discard this unfinished import?")) return;
        allowDirtyNavigationRef.current = true; setTitle(""); setText(""); closeSurface("import", { panel: null });
        window.setTimeout(() => { allowDirtyNavigationRef.current = false; }, 0);
      }} type="button">Cancel</button><button className="simple-primary" disabled={!text.trim() || importing || (delimitedImport && !title.trim())} onClick={() => void importText()} type="button">
        {importing ? <LoaderCircle className="simple-spin" size={17} /> : <Sparkles size={17} />}Prepare cards</button></div>
    </section> : null}
    {batch ? <ReviewBatchPanel batch={batch} onBatch={setBatch} onDismiss={() => { setBatch(null); setNotice(""); }} onCommitted={() => {
      setBatch(null); setAdded(true); void onItemsReload();
    }} /> : null}
    {added ? <div className="capture-added"><strong>Added to Library</strong><div>{languageHasAudio(language) ? <button onClick={onListen} type="button">Listen now</button> : null}</div></div> : null}
    {notice ? <p className="simple-library-notice" aria-live="polite">{notice}</p> : null}

    <section className="simple-library-panel simple-library-panel--main" data-onboarding-target="library">
      <div className="simple-library-tools"><label className="simple-search"><input aria-label="Search cards" autoComplete="off" name="library-search" onChange={(event) => setSearchInput(event.target.value)} placeholder="Search cards…" type="search" value={searchInput} /></label>
        <label><span className="simple-library-filter-label">Status</span><select aria-label="Filter by status" name="library-status" onChange={(event) => patchRoute({ status: event.target.value as LibraryStatus, page: 1 })} value={status}>
          <option value="all">All</option><option value="new">New</option><option value="learning">Learning</option><option value="due">Due</option>
          <option value="strong">Strong</option><option value="learned">Learned</option></select></label>
        <label><span className="simple-library-filter-label">Topic</span><select aria-label="Filter by Topic" name="library-topic" onChange={(event) => patchRoute({ topic: event.target.value, page: 1 })} value={topic}><option value="all">All Topics</option>{topics.map((value) => <option key={value.publicId} value={value.publicId}>{value.title} · {value.progress.dueNow} due · {value.progress.new} not recalled yet</option>)}</select></label>
        <label><span className="simple-library-filter-label">Order</span><select aria-label="Sort cards" name="library-sort" onChange={(event) => patchRoute({ sort: event.target.value as LibrarySort, page: 1 })} value={sort}>
          <option value="recent">Recent</option><option value="oldest">Oldest</option><option value="due">Due soon</option><option value="least">Least practiced</option><option value="az">A–Z</option></select></label></div>
      <div className={`simple-library-selection${selectionMode ? "" : " is-idle"}`}>
        {selectionMode ? <label><input aria-label="Select all visible cards" checked={allVisibleSelected} disabled={!displayedItems.length || deletingSelected} name="select-visible-cards" onChange={toggleVisible} type="checkbox" />
          <span>{displayedItems.length} visible</span></label> : <div className="simple-library-selection-start">
          <button disabled={!displayedItems.length} onClick={() => setSelectionMode(true)} type="button">Select</button>
          <span>{displayedItems.length} of {visibleItems.length} cards</span></div>}
        {selectionMode ? <div>
          {selectedItemIds.size ? <><span>{selectedItemIds.size} selected</span>
            <button disabled={deletingSelected} onClick={() => setSelectedItemIds(new Set())} type="button">Clear</button>
            <button disabled={deletingSelected || selectedItemIds.size > 500} onClick={() => setBulkCategories(true)} type="button">Add to categories…</button>
            <button className="simple-delete-selected" disabled={deletingSelected} onClick={() => void deleteSelected()} type="button">
              {deletingSelected ? <LoaderCircle className="simple-spin" size={15} /> : <Trash2 size={15} />}Delete</button></> : null}
          <button onClick={() => { setSelectedItemIds(new Set()); setSelectionMode(false); }} type="button">Done</button>
        </div> : null}
      </div><div className="simple-phrase-list">
        {!visibleItems.length ? <div className="simple-library-empty"><strong>No matching cards</strong><span>Try a different word or clear the current filters.</span>
          <button onClick={() => { setSearchInput(""); patchRoute({ query: "", status: "all", topic: "all", sort: "recent", page: 1 }); }} type="button">Clear filters</button></div> : null}
        {displayedItems.map((item) => <article className={`simple-phrase-row${selectionMode ? " is-selecting" : ""}${selectedItemIds.has(item.publicId) ? " is-selected" : ""}`} key={item.publicId}>
          {selectionMode ? <label className="simple-card-select"><input aria-label={`Select ${item.target}`} checked={selectedItemIds.has(item.publicId)} name={`select-card-${item.publicId}`}
            disabled={deletingSelected} onChange={() => toggleItem(item.publicId)} type="checkbox" /></label> : null}
          <div className="simple-phrase-copy-shell"><div className="simple-phrase-copy"><strong lang={language}><FocusedText focusTerms={item.focusTerms} text={item.target} /></strong><small lang="ru">{item.cue}</small></div></div>
          <div className="simple-row-actions"><CardSources item={item} sets={[...categories, ...topics]} />
              {languageHasAudio(language) ? <button aria-label="Play" onClick={() => {
                void onPlay(item.target).then(() => onListened(item.publicId));
              }} title="Play" type="button"><Volume2 size={15} /></button> : null}
              <CardActions target={item.target} onEdit={() => patchRoute({ edit: item.publicId }, "push")}
                onDelete={() => void deleteItem(item.publicId)} extraActions={[
                  { label: item.practiceEnabled ? "Mark as learned" : "Return to learning", onClick: () => void setPracticeEnabled(item.publicId, !item.practiceEnabled) },
                  ...(!item.practiceEnabled ? [{ label: "Review now", onClick: () => onReview(item.publicId) }] : []),
                  { label: "Pattern drill", onClick: () => void patternDrill(item.publicId) },
                ]} />
            </div>
        </article>)}
        {displayedItems.length < visibleItems.length ? <div className="simple-library-load-more"><span>{visibleItems.length - displayedItems.length} more cards</span>
          <button onClick={() => patchRoute({ page: route.page + 1 })} type="button">Load more</button></div> : null}
      </div>
    </section>
    </>}
    {editingItem ? <CardEditorDialog item={editingItem} language={language} onClose={() => closeSurface("editor", { edit: null })}
      onDeleted={(id) => { itemDeleted(id); if (showTopics) setTopicsRevision((value) => value + 1); }}
      onSaved={(item) => {
        onItemUpdated(item); void refreshTopics();
        patchRoute({ edit: null }, "replace");
        if (showTopics) setTopicsRevision((revision) => revision + 1);
      }} /> : null}
    {bulkCategories ? <AddToCategoriesDialog language={language} itemIds={[...selectedItemIds]} onClose={() => setBulkCategories(false)}
      onSaved={() => { setBulkCategories(false); setSelectedItemIds(new Set()); setSelectionMode(false); void onItemsReload(); void refreshTopics(); setNotice("Cards added to categories."); }} /> : null}
    {showCreate ? <CardCreateDialog initialTopicId={["all", "liked"].includes(route.topic) ? "" : route.topic} language={language} topics={topics.filter((candidate) => candidate.publicId !== "liked")}
      onClose={() => closeSurface("create", { panel: null })} onCreated={() => {
        closeSurface("create", { panel: null }); void onItemsReload(); void refreshTopics();
        if (showTopics) setTopicsRevision((revision) => revision + 1);
      }} /> : null}
  </main>;
}
