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
import { TopicsManager } from "./TopicsManager";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { filterLibraryItems, libraryStatusOf, type LibrarySort, type LibraryStatus } from "../../lib/libraryView";

export function LibraryPage({ language, onAvailability, onListen, onPlay, onPracticeEnabled, onReview }: {
  language: Language;
  onAvailability: (online: boolean) => void;
  onListen: () => void;
  onPlay: (text: string) => void;
  onPracticeEnabled: (itemId: string, practiceEnabled: boolean) => Promise<boolean>;
  onReview: (itemId: string) => void;
}) {
  const [items, setItems] = useState<LearningItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatus>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [topic, setTopic] = useState("all");
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topicItemIds, setTopicItemIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [showTopics, setShowTopics] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [added, setAdded] = useState(false);
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ target: "", cue: "", note: "", frequencyBand: "common" });

  const load = async () => {
    try {
      const response = await apiFetch(`/api/items?language=${language}&limit=500&includeSchedule=true`);
      if (!response.ok) throw new Error("Library unavailable");
      const data = await response.json() as { items: LearningItem[] };
      setItems(data.items || []); setLoadError(false); onAvailability(true);
    } catch { setItems([]); setLoadError(true); onAvailability(false); }
  };
  const loadTopics = async () => {
    const response = await apiFetch(`/api/islands?language=${language}`);
    if (!response.ok) throw new Error("Topics unavailable");
    const data = await response.json() as { islands: IslandSummary[] };
    setTopics(data.islands || []);
  };

  useEffect(() => {
    setStatus("all"); setTopic("all"); setTopicItemIds([]); setBatch(null); setAdded(false);
    void load(); void loadTopics().catch(() => { setTopics([]); setLoadError(true); onAvailability(false); });
  }, [language]);
  useEffect(() => {
    if (topic === "all") { setTopicItemIds([]); return; }
    void apiFetch(`/api/islands/${encodeURIComponent(topic)}`).then(async (response) => {
      if (!response.ok) throw new Error("Topic unavailable");
      const data = await response.json() as { island: Island };
      setTopicItemIds(data.island.items.map((item) => item.publicId)); onAvailability(true);
    }).catch(() => { setTopicItemIds([]); setLoadError(true); onAvailability(false); });
  }, [topic]);

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
  const beginEdit = (item: LearningItem) => {
    setEditing(item.publicId);
    setEditDraft({ target: item.target, cue: item.cue, note: item.note, frequencyBand: item.frequencyBand });
  };
  const saveEdit = async (itemId: string) => {
    const response = await apiFetch(`/api/items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editDraft) });
    if (response.ok) { setEditing(null); await load(); }
  };
  const deleteItem = async (itemId: string) => {
    if (!window.confirm("Delete this card from Library?")) return;
    const response = await apiFetch(`/api/items/${itemId}`, { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((item) => item.publicId !== itemId));
  };
  const setPracticeEnabled = async (itemId: string, practiceEnabled: boolean) => {
    if (!await onPracticeEnabled(itemId, practiceEnabled)) { setNotice("Couldn’t update this card."); return; }
    setItems((current) => current.map((item) => item.publicId === itemId ? { ...item, practiceEnabled } : item));
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

  return <main className="simple-main"><header className="simple-page-heading"><div><h1>Library</h1><p>{items.length} cards</p></div>
    <div className="simple-library-heading-actions"><button onClick={() => setShowTopics((shown) => !shown)} type="button">Manage topics</button>
      <button onClick={() => setShowImport((shown) => !shown)} type="button">Import text</button></div></header>
    {loadError ? <div className="simple-unavailable" role="alert"><span>Library unavailable.</span><button onClick={() => void load()} type="button"><RefreshCw size={14} />Retry</button></div> : null}
    {showTopics ? <div className="simple-library-secondary"><TopicsManager language={language} /><button onClick={() => { setShowTopics(false); void loadTopics(); }} type="button">Close</button></div> : null}
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
      setBatch(null); setAdded(true); void load();
    }} /> : null}
    {added ? <div className="capture-added"><strong>Added to Library</strong><div>{language === "en" ? <button onClick={onListen} type="button">Listen now</button> : null}</div></div> : null}
    {notice ? <p className="simple-library-notice" aria-live="polite">{notice}</p> : null}

    <section className="simple-library-panel simple-library-panel--main">
      <div className="simple-library-tools"><label className="simple-search"><Search size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Search" type="search" value={query} /></label>
        <select aria-label="Filter by status" onChange={(event) => setStatus(event.target.value as LibraryStatus)} value={status}>
          <option value="all">All</option><option value="new">New</option><option value="learning">Learning</option><option value="learned">Learned</option></select>
        <select aria-label="Filter by Topic" onChange={(event) => setTopic(event.target.value)} value={topic}><option value="all">All Topics</option>{topics.map((value) => <option key={value.publicId} value={value.publicId}>{value.title}</option>)}</select>
        <select aria-label="Sort cards" onChange={(event) => setSort(event.target.value as LibrarySort)} value={sort}>
          <option value="recent">Recent</option><option value="oldest">Oldest</option><option value="due">Due soon</option><option value="az">A–Z</option></select></div>
      <div className="simple-library-count">{visibleItems.length} cards</div><div className="simple-phrase-list">
        {!visibleItems.length && !loadError ? <p className="simple-library-empty">No cards</p> : null}
        {visibleItems.map((item) => <article className="simple-phrase-row" key={item.publicId}>
          {editing === item.publicId ? <div className="simple-library-edit"><input onChange={(event) => setEditDraft((current) => ({ ...current, target: event.target.value }))} value={editDraft.target} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, cue: event.target.value }))} value={editDraft.cue} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Note" value={editDraft.note} />
            <select onChange={(event) => setEditDraft((current) => ({ ...current, frequencyBand: event.target.value }))} value={editDraft.frequencyBand}><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option></select>
            <div><button onClick={() => setEditing(null)} type="button">Cancel</button><button className="is-primary" onClick={() => void saveEdit(item.publicId)} type="button">Save</button></div></div>
          : <div><strong>{item.target}</strong><small>{item.cue}</small><em>{[libraryStatusOf(item), item.tags[0], item.frequencyBand].filter(Boolean).join(" · ")}</em></div>}
          {editing !== item.publicId ? <div className="simple-row-actions">
            {language === "en" ? <button aria-label="Play" onClick={() => onPlay(item.target)} type="button"><Volume2 size={15} /></button> : null}
            {item.practiceEnabled ? <button onClick={() => void setPracticeEnabled(item.publicId, false)} type="button">Move to Learned</button> : <>
              <button onClick={() => onReview(item.publicId)} type="button">Review</button>
              <button onClick={() => void setPracticeEnabled(item.publicId, true)} type="button">Return to learning</button></>}
            <button onClick={() => void patternDrill(item.publicId)} type="button">Make pattern drill</button>
            <button aria-label="Edit" onClick={() => beginEdit(item)} type="button"><Pencil size={15} /></button>
            <button aria-label="Delete" onClick={() => void deleteItem(item.publicId)} type="button"><Trash2 size={15} /></button></div> : null}
        </article>)}
      </div>
    </section>
  </main>;
}
