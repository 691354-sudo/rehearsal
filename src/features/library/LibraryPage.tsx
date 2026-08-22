import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilePlus2,
  LoaderCircle,
  Pencil,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { CardEditorDialog } from "./CardEditorDialog";
import { CardCreateDialog } from "./CardCreateDialog";
import { TopicsManager } from "./TopicsManager";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { languageHasAudio } from "../../shared/config";
import { filterLibraryItems, type LibrarySort, type LibraryStatus } from "../../lib/libraryView";
import type { AppRoute, HistoryMode, LibraryRoute } from "../../lib/appRoute";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressBadge } from "../progress/LearningProgress";

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
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [topicsRevision, setTopicsRevision] = useState(0);
  const allowDirtyNavigationRef = useRef(false);
  const showTopics = route.view === "topics";
  const showImport = route.panel === "import";
  const showCreate = route.panel === "create";
  const editingItem = route.edit ? items.find((item) => item.publicId === route.edit) || null : null;
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
  useEffect(() => {
    if (!openActionsId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenActionsId(null);
    };
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-library-actions="${openActionsId}"]`)) return;
      setOpenActionsId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [openActionsId]);

  const loadTopics = async (nextLanguage = language) => {
    const response = await apiFetch(`/api/islands?language=${nextLanguage}`);
    if (!response.ok) throw new Error("Topics unavailable");
    const data = await response.json() as { islands: IslandSummary[] };
    return data.islands || [];
  };
  const loadTopicItemIds = async (topicId: string) => {
    const response = await apiFetch(`/api/islands/${encodeURIComponent(topicId)}`);
    if (!response.ok) throw new Error("Topic unavailable");
    const data = await response.json() as { island: Island };
    return data.island.items.map((item) => item.publicId);
  };
  const refreshTopics = async () => {
    try {
      const [loadedTopics, loadedItemIds] = await Promise.all([
        loadTopics(),
        topic === "all" ? Promise.resolve([]) : loadTopicItemIds(topic),
      ]);
      setTopics(loadedTopics);
      if (topic !== "all") setTopicItemIds(loadedItemIds);
      setTopicsError(false);
    } catch {
      setTopicsError(true);
    }
  };

  useEffect(() => {
    let active = true;
    setTopicItemIds([]); setBatch(null); setAdded(false); setSelectedItemIds(new Set());
    setTopics([]); setTopicsError(false);
    void loadTopics(language).then((loadedTopics) => {
      if (active) setTopics(loadedTopics);
    }).catch(() => {
      if (active) setTopicsError(true);
    });
    return () => { active = false; };
  }, [language]);
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
  const deleteItem = async (itemId: string) => {
    if (!window.confirm("Delete this card from Library?")) return;
    setNotice("");
    try {
      const response = await apiFetch(`/api/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      onItemDeleted(itemId);
      setSelectedItemIds((current) => { const next = new Set(current); next.delete(itemId); return next; });
    } catch { setNotice("Couldn’t delete this card."); }
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
  const visibleItems = useMemo(() => filterLibraryItems(items, {
    query, status, sort, topicItemIds: topic === "all" ? null : topicItemSet, language,
  }), [items, language, query, sort, status, topic, topicItemSet]);
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

  return <main className="simple-main" id="main-content"><header className="simple-page-heading"><div><h1>Library</h1><p>{items.length} cards</p></div>
    <div className="simple-library-heading-actions"><button onClick={() => patchRoute({ view: showTopics ? "cards" : "topics", panel: null, edit: null }, "push")} type="button">{showTopics ? "Back to cards" : "Manage topics"}</button>
      <button className="simple-add-card" onClick={() => patchRoute({ panel: "create", edit: null }, "push")} type="button"><Plus size={15} />Add card</button>
      {!showTopics ? <button onClick={() => showImport ? closeSurface("import", { panel: null }) : patchRoute({ panel: "import", edit: null }, "push")} type="button">{showImport ? "Close import" : "Import text"}</button> : null}</div></header>
    {topicsError ? <div className="simple-unavailable" role="alert"><span>Topics unavailable. Your cards are still here.</span><button onClick={() => void refreshTopics()} type="button"><RefreshCw size={14} />Retry</button></div> : null}
    {showTopics ? <div className="simple-library-secondary"><TopicsManager initialTopicId={route.topic === "all" ? "" : route.topic} key={`${language}:${topicsRevision}`} language={language}
      onClose={() => { patchRoute({ view: "cards" }, "replace"); void refreshTopics(); }}
      onCreateNew={() => patchRoute({ panel: "create", edit: null }, "push")}
      onEdit={(itemId) => patchRoute({ edit: itemId }, "push")}
      onTopic={(topicId) => patchRoute({ topic: topicId || "all" }, "replace")} /></div> : <>
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

    <section className="simple-library-panel simple-library-panel--main">
      <div className="simple-library-tools"><label className="simple-search"><Search size={17} /><input aria-label="Search cards" autoComplete="off" name="library-search" onChange={(event) => setSearchInput(event.target.value)} placeholder="Search cards…" type="search" value={searchInput} /></label>
        <select aria-label="Filter by status" name="library-status" onChange={(event) => patchRoute({ status: event.target.value as LibraryStatus, page: 1 })} value={status}>
          <option value="all">All</option><option value="new">New</option><option value="learning">Learning</option><option value="due">Due</option>
          <option value="strong">Strong</option><option value="learned">Learned</option></select>
        <select aria-label="Filter by Topic" name="library-topic" onChange={(event) => patchRoute({ topic: event.target.value, page: 1 })} value={topic}><option value="all">All Topics</option>{topics.map((value) => <option key={value.publicId} value={value.publicId}>{value.title} · {value.progress.dueNow} due · {value.progress.new} new</option>)}</select>
        <select aria-label="Sort cards" name="library-sort" onChange={(event) => patchRoute({ sort: event.target.value as LibrarySort, page: 1 })} value={sort}>
          <option value="recent">Recent</option><option value="oldest">Oldest</option><option value="due">Due soon</option><option value="least">Least practiced</option><option value="az">A–Z</option></select></div>
      <div className={`simple-library-selection${selectionMode ? "" : " is-idle"}`}>
        {selectionMode ? <label><input aria-label="Select all visible cards" checked={allVisibleSelected} disabled={!displayedItems.length || deletingSelected} name="select-visible-cards" onChange={toggleVisible} type="checkbox" />
          <span>{displayedItems.length} visible</span></label> : <div className="simple-library-selection-start">
          <button disabled={!displayedItems.length} onClick={() => setSelectionMode(true)} type="button">Select</button>
          <span>{displayedItems.length} of {visibleItems.length} cards</span></div>}
        {selectionMode ? <div>
          {selectedItemIds.size ? <><span>{selectedItemIds.size} selected</span>
            <button disabled={deletingSelected} onClick={() => setSelectedItemIds(new Set())} type="button">Clear</button>
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
          <div className="simple-phrase-copy"><strong lang={language}><FocusedText focusTerms={item.focusTerms} text={item.target} /></strong><small lang="ru">{item.cue}</small></div>
          <div className="simple-row-side"><div className="simple-row-actions">
              {languageHasAudio(language) ? <button aria-label="Play" onClick={() => {
                void onPlay(item.target).then(() => onListened(item.publicId));
              }} title="Play" type="button"><Volume2 size={15} /></button> : null}
              {item.practiceEnabled
                ? <button aria-label={`Mark ${item.target} as learned`} onClick={() => void setPracticeEnabled(item.publicId, false)} type="button">Learned</button>
                : <button onClick={() => void setPracticeEnabled(item.publicId, true)} type="button">Reactivate</button>}
              <button aria-label={`Edit ${item.target}`} onClick={() => patchRoute({ edit: item.publicId }, "push")} title="Edit" type="button"><Pencil size={16} /></button>
              <div className="simple-row-more" data-library-actions={item.publicId} onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpenActionsId(null);
              }}>
                <button aria-controls={`card-actions-${item.publicId}`} aria-expanded={openActionsId === item.publicId} aria-label={`More actions for ${item.target}`}
                  onClick={() => setOpenActionsId((current) => current === item.publicId ? null : item.publicId)} title="More actions" type="button"><MoreHorizontal size={17} /></button>
                {openActionsId === item.publicId ? <div className="simple-row-more-panel" id={`card-actions-${item.publicId}`}>
                  {!item.practiceEnabled ? <button onClick={() => { setOpenActionsId(null); onReview(item.publicId); }} type="button">Review now</button> : null}
                  <button onClick={() => { setOpenActionsId(null); void patternDrill(item.publicId); }} type="button">Pattern drill</button>
                  <button className="simple-row-delete" onClick={() => { setOpenActionsId(null); void deleteItem(item.publicId); }} type="button"><Trash2 size={15} />Delete</button>
                </div> : null}
              </div>
            </div><LearningProgressBadge progress={item.progress} /></div>
        </article>)}
        {displayedItems.length < visibleItems.length ? <div className="simple-library-load-more"><span>{visibleItems.length - displayedItems.length} more cards</span>
          <button onClick={() => patchRoute({ page: route.page + 1 })} type="button">Load more</button></div> : null}
      </div>
    </section>
    </>}
    {editingItem ? <CardEditorDialog item={editingItem} language={language} onClose={() => closeSurface("editor", { edit: null })}
      onSaved={(item) => { onItemUpdated(item); if (showTopics) setTopicsRevision((revision) => revision + 1); closeSurface("editor", { edit: null }); }} /> : null}
    {showCreate ? <CardCreateDialog initialTopicId={route.topic === "all" ? "" : route.topic} language={language} topics={topics}
      onClose={() => closeSurface("create", { panel: null })} onCreated={() => {
        closeSurface("create", { panel: null }); void onItemsReload(); void refreshTopics();
        if (showTopics) setTopicsRevision((revision) => revision + 1);
      }} /> : null}
  </main>;
}
