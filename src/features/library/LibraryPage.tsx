import { useEffect, useMemo, useState } from "react";
import {
  FilePlus2,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { CardEditorDialog } from "./CardEditorDialog";
import { TopicsManager } from "./TopicsManager";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { filterLibraryItems, libraryStatusOf, type LibrarySort, type LibraryStatus } from "../../lib/libraryView";

export function LibraryPage({ items, language, onItemDeleted, onItemUpdated, onItemsReload, onListen, onPlay, onPracticeEnabled, onReview }: {
  items: LearningItem[];
  language: Language;
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: (item: LearningItem) => void;
  onItemsReload: () => Promise<boolean>;
  onListen: () => void;
  onPlay: (text: string) => void;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onReview: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatus>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [topic, setTopic] = useState("all");
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItemIds, setTopicItemIds] = useState<string[]>([]);
  const [topicsError, setTopicsError] = useState(false);
  const [showTopics, setShowTopics] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [added, setAdded] = useState(false);
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

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
    setStatus("all"); setTopic("all"); setTopicItemIds([]); setBatch(null); setAdded(false); setSelectedItemIds(new Set());
    setVisibleCount(50);
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
      const response = await apiFetch("/api/import/text", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, title: title.trim() || "Imported text", text }) });
      if (!response.ok) throw new Error("Import failed");
      const data = await response.json() as { batch: ReviewBatch };
      setBatch(data.batch); setShowImport(false); setTitle(""); setText("");
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
  const visibleItems = useMemo(() => filterLibraryItems(items, {
    query, status, sort, topicItemIds: topic === "all" ? null : topicItemSet,
  }), [items, query, sort, status, topic, topicItemSet]);
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
      setNotice(`${data.deleted.length} ${data.deleted.length === 1 ? "card" : "cards"} deleted.`);
    } catch {
      const reloaded = await onItemsReload();
      setNotice(reloaded
        ? "The deletion result was unclear, so Library was reloaded. Check the remaining selection before trying again."
        : "Couldn’t confirm the bulk deletion. Reconnect and reload Library before trying again.");
    }
    finally { setDeletingSelected(false); }
  };

  return <main className="simple-main"><header className="simple-page-heading"><div><h1>Library</h1><p>{items.length} cards</p></div>
    <div className="simple-library-heading-actions"><button onClick={() => setShowTopics((shown) => !shown)} type="button">Manage topics</button>
      {!showTopics ? <button onClick={() => setShowImport((shown) => !shown)} type="button">Import text</button> : null}</div></header>
    {topicsError ? <div className="simple-unavailable" role="alert"><span>Topics unavailable. Your cards are still here.</span><button onClick={() => void refreshTopics()} type="button"><RefreshCw size={14} />Retry</button></div> : null}
    {showTopics ? <div className="simple-library-secondary"><TopicsManager language={language} onClose={() => { setShowTopics(false); void refreshTopics(); }} /></div> : <>
      {showImport ? <section className="simple-import-card simple-library-secondary">
      <div className="simple-section-heading"><FilePlus2 size={19} /><div><strong>Import text or transcript</strong></div></div>
      <input onChange={(event) => setTitle(event.target.value)} placeholder="Title or source" value={title} />
      <label className="simple-file-button"><Upload size={16} />Upload .txt<input accept=".txt,text/plain" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return; setTitle(file.name.replace(/\.txt$/i, "")); setText(await file.text());
      }} type="file" /></label>
      <textarea onChange={(event) => setText(event.target.value)} placeholder="Paste text or transcript…" rows={7} value={text} />
      <div className="simple-library-panel-actions"><button onClick={() => setShowImport(false)} type="button">Cancel</button><button className="simple-primary" disabled={!text.trim() || importing} onClick={() => void importText()} type="button">
        {importing ? <LoaderCircle className="simple-spin" size={17} /> : <Sparkles size={17} />}Prepare cards</button></div>
    </section> : null}
    {batch ? <ReviewBatchPanel batch={batch} onBatch={setBatch} onDismiss={() => { setBatch(null); setNotice(""); }} onCommitted={() => {
      setBatch(null); setAdded(true); void onItemsReload();
    }} /> : null}
    {added ? <div className="capture-added"><strong>Added to Library</strong><div>{language === "en" ? <button onClick={onListen} type="button">Listen now</button> : null}</div></div> : null}
    {notice ? <p className="simple-library-notice" aria-live="polite">{notice}</p> : null}

    <section className="simple-library-panel simple-library-panel--main">
      <div className="simple-library-tools"><label className="simple-search"><Search size={17} /><input onChange={(event) => { setQuery(event.target.value); setVisibleCount(50); }} placeholder="Search" type="search" value={query} /></label>
        <select aria-label="Filter by status" onChange={(event) => { setStatus(event.target.value as LibraryStatus); setVisibleCount(50); }} value={status}>
          <option value="all">All</option><option value="new">New</option><option value="learning">Learning</option><option value="learned">Learned</option></select>
        <select aria-label="Filter by Topic" onChange={(event) => { setTopic(event.target.value); setVisibleCount(50); }} value={topic}><option value="all">All Topics</option>{topics.map((value) => <option key={value.publicId} value={value.publicId}>{value.title}</option>)}</select>
        <select aria-label="Sort cards" onChange={(event) => { setSort(event.target.value as LibrarySort); setVisibleCount(50); }} value={sort}>
          <option value="recent">Recent</option><option value="oldest">Oldest</option><option value="due">Due soon</option><option value="az">A–Z</option></select></div>
      <div className="simple-library-selection">
        <label><input aria-label="Select all visible cards" checked={allVisibleSelected} disabled={!displayedItems.length || deletingSelected} onChange={toggleVisible} type="checkbox" />
          <span>{displayedItems.length} of {visibleItems.length} cards</span></label>
        {selectedItemIds.size ? <div><span>{selectedItemIds.size} selected</span>
          <button disabled={deletingSelected} onClick={() => setSelectedItemIds(new Set())} type="button">Clear</button>
          <button className="simple-delete-selected" disabled={deletingSelected} onClick={() => void deleteSelected()} type="button">
            {deletingSelected ? <LoaderCircle className="simple-spin" size={15} /> : <Trash2 size={15} />}Delete</button></div> : null}
      </div><div className="simple-phrase-list">
        {!visibleItems.length ? <p className="simple-library-empty">No cards</p> : null}
        {displayedItems.map((item) => <article className={`simple-phrase-row${selectedItemIds.has(item.publicId) ? " is-selected" : ""}`} key={item.publicId}>
          <label className="simple-card-select"><input aria-label={`Select ${item.target}`} checked={selectedItemIds.has(item.publicId)}
            disabled={deletingSelected} onChange={() => toggleItem(item.publicId)} type="checkbox" /></label>
          <div className="simple-phrase-copy"><strong>{item.target}</strong><small>{item.cue}</small><em>{[libraryStatusOf(item), item.tags[0], item.frequencyBand].filter(Boolean).join(" · ")}</em></div>
          <div className="simple-row-actions">
            {language === "en" ? <button aria-label="Play" onClick={() => onPlay(item.target)} title="Play" type="button"><Volume2 size={15} /></button> : null}
            {item.practiceEnabled ? <button onClick={() => void setPracticeEnabled(item.publicId, false)} type="button">Learned</button> : <>
              <button onClick={() => onReview(item.publicId)} type="button">Review</button>
              <button onClick={() => void setPracticeEnabled(item.publicId, true)} type="button">Reactivate</button></>}
            <button onClick={() => void patternDrill(item.publicId)} type="button">Pattern drill</button>
            <button aria-label="Edit" onClick={() => setEditingItem(item)} title="Edit" type="button"><Pencil size={15} /></button>
            <button aria-label="Delete" onClick={() => void deleteItem(item.publicId)} title="Delete" type="button"><Trash2 size={15} /></button></div>
        </article>)}
        {displayedItems.length < visibleItems.length ? <div className="simple-library-load-more"><span>{visibleItems.length - displayedItems.length} more cards</span>
          <button onClick={() => setVisibleCount((current) => current + 50)} type="button">Load more</button></div> : null}
      </div>
    </section>
      {editingItem ? <CardEditorDialog item={editingItem} language={language} onClose={() => setEditingItem(null)}
      onSaved={(item) => { onItemUpdated(item); setEditingItem(null); }} /> : null}
    </>}
  </main>;
}
