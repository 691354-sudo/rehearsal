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
  WandSparkles,
} from "lucide-react";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { TopicsManager } from "./TopicsManager";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language, LearningItem } from "../../shared/contracts";

export function LibraryPage({ language, onAvailability, onPlay }: {
  language: Language;
  onAvailability: (online: boolean) => void;
  onPlay: (text: string) => void;
}) {
  const [items, setItems] = useState<LearningItem[]>([]); const [query, setQuery] = useState("");
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  const [topic, setTopic] = useState("all"); const [frequency, setFrequency] = useState("all");
  const [topics, setTopics] = useState<IslandSummary[]>([]); const [topicItemIds, setTopicItemIds] = useState<string[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [importing, setImporting] = useState(false); const [notice, setNotice] = useState("");
  const [batch, setBatch] = useState<ReviewBatch | null>(null); const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ target: "", cue: "", note: "", category: "", frequencyBand: "common" });
  const load = async () => {
    const path = query.trim() ? `/api/search?q=${encodeURIComponent(query)}&language=${language}&limit=100` : `/api/items?language=${language}&limit=500&includeSchedule=true`;
    try {
      const response = await apiFetch(path);
      if (!response.ok) throw new Error("Library unavailable");
      const data = await response.json() as { items: LearningItem[] };
      setItems(data.items || []); setLoadError(false); onAvailability(true);
    } catch { setItems([]); setLoadError(true); onAvailability(false); }
  };
  useEffect(() => { const timeout = window.setTimeout(() => void load(), query ? 250 : 0); return () => window.clearTimeout(timeout); }, [language, query]);
  useEffect(() => {
    setTopic("all"); setTopicItemIds([]);
    void apiFetch(`/api/islands?language=${language}`).then(async (response) => {
      if (!response.ok) throw new Error("Topics unavailable");
      const data = await response.json() as { islands: IslandSummary[] };
      setTopics(data.islands || []); onAvailability(true);
    }).catch(() => { setTopics([]); setLoadError(true); onAvailability(false); });
  }, [language, onAvailability]);
  useEffect(() => {
    if (topic === "all") { setTopicItemIds([]); return; }
    void apiFetch(`/api/islands/${encodeURIComponent(topic)}`).then(async (response) => {
      if (!response.ok) throw new Error("Topic unavailable");
      const data = await response.json() as { island: Island };
      setTopicItemIds(data.island.items.map((item) => item.publicId)); onAvailability(true);
    }).catch(() => { setTopicItemIds([]); setLoadError(true); onAvailability(false); });
  }, [onAvailability, topic]);
  const importText = async () => {
    if (!text.trim()) return; setImporting(true); setNotice(""); setBatch(null);
    try {
      const response = await apiFetch("/api/import/text", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, title: title.trim() || "Imported text", text }) });
      if (!response.ok) throw new Error("Import failed");
      const data = await response.json() as { batch: ReviewBatch; previewSentences: string[] };
      setBatch(data.batch); setNotice("Source saved. Select the cards you want to keep."); setTitle(""); setText("");
    } catch { setNotice("Import failed. Nothing was added to Library."); } finally { setImporting(false); }
  };
  const beginEdit = (row: LearningItem) => { setEditing(row.publicId); setEditDraft({
    target: row.target, cue: row.cue, note: row.note, category: row.tags[0] || "", frequencyBand: row.frequencyBand || "common",
  }); };
  const saveEdit = async (itemId: string) => {
    const response = await apiFetch(`/api/items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      target: editDraft.target, cue: editDraft.cue, note: editDraft.note, tags: editDraft.category ? [editDraft.category] : [], frequencyBand: editDraft.frequencyBand,
    }) });
    if (response.ok) { setEditing(null); await load(); }
  };
  const deleteItem = async (itemId: string) => {
    if (!window.confirm("Delete this card from Library?")) return;
    const response = await apiFetch(`/api/items/${itemId}`, { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((item) => item.publicId !== itemId));
  };
  const patternDrill = async (itemId: string) => {
    setNotice("Preparing pattern variants…");
    try { const response = await apiFetch(`/api/items/${itemId}/pattern-drill`, { method: "POST" });
      if (!response.ok) throw new Error("Pattern failed"); const data = await response.json() as { batch: ReviewBatch };
      setBatch(data.batch); setNotice("Choose only the variants worth keeping.");
    } catch { setNotice("Couldn’t prepare pattern variants."); }
  };
  const topicItemSet = useMemo(() => new Set(topicItemIds), [topicItemIds]);
  const visibleItems = useMemo(() => items.filter((item) =>
    (topic === "all" || topicItemSet.has(item.publicId)) && (frequency === "all" || (item.frequencyBand || "common") === frequency)), [frequency, items, topic, topicItemSet]);
  return <main className="simple-main"><header className="simple-page-heading"><div><h1>Library</h1><p>Your approved cards and source material.</p></div></header>
    {loadError ? <div className="simple-unavailable" role="alert"><span>Library unavailable.</span><button onClick={() => void load()} type="button"><RefreshCw size={14} />Retry</button></div> : null}
    {batch ? <ReviewBatchPanel batch={batch} onBatch={setBatch} onCommitted={() => void load()} /> : null}
    <TopicsManager language={language} />
    <div className="simple-library-layout"><section className="simple-import-card">
      <div className="simple-section-heading"><FilePlus2 size={19} /><div><strong>Add text</strong><span>It stays a draft until you approve cards.</span></div></div>
      <input onChange={(event) => setTitle(event.target.value)} placeholder="Title or source" value={title} />
      <label className="simple-file-button"><Upload size={16} />Upload .txt<input accept=".txt,text/plain" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return; setTitle(file.name.replace(/\.txt$/i, "")); setText(await file.text());
      }} type="file" /></label>
      <textarea onChange={(event) => setText(event.target.value)} placeholder="Paste a text, transcript, or story…" rows={9} value={text} />
      <button className="simple-primary" disabled={!text.trim() || importing} onClick={() => void importText()} type="button">
        {importing ? <LoaderCircle className="simple-spin" size={17} /> : <Sparkles size={17} />}Prepare cards</button>
      {notice && <p className="simple-import-notice">{notice}</p>}
    </section><section className="simple-library-panel">
      <div className="simple-library-tools"><label className="simple-search"><Search size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Find a phrase or thought" type="search" value={query} /></label>
        <select aria-label="Filter by Topic" onChange={(event) => setTopic(event.target.value)} value={topic}><option value="all">All Topics</option>{topics.map((value) => <option key={value.publicId} value={value.publicId}>{value.title}</option>)}</select>
        <select aria-label="Filter by frequency" onChange={(event) => setFrequency(event.target.value)} value={frequency}><option value="all">Any frequency</option><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option></select></div>
      <div className="simple-library-count">{visibleItems.length} cards</div><div className="simple-phrase-list">
        {visibleItems.map((row) => <article className="simple-phrase-row" key={row.publicId}>
          {editing === row.publicId ? <div className="simple-library-edit"><input onChange={(event) => setEditDraft((current) => ({ ...current, target: event.target.value }))} value={editDraft.target} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, cue: event.target.value }))} value={editDraft.cue} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category" value={editDraft.category} />
            <select onChange={(event) => setEditDraft((current) => ({ ...current, frequencyBand: event.target.value }))} value={editDraft.frequencyBand}><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option></select>
            <div><button onClick={() => setEditing(null)} type="button">Cancel</button><button className="is-primary" onClick={() => void saveEdit(row.publicId)} type="button">Save</button></div></div>
          : <div><strong>{row.target}</strong><small>{row.cue}</small><em>{[row.tags[0], row.frequencyBand || "common", row.currency || "current"].filter(Boolean).join(" · ")}</em></div>}
          {editing !== row.publicId ? <div className="simple-row-actions"><button aria-label="Play" onClick={() => onPlay(row.target)} type="button"><Volume2 size={16} /></button>
            <button aria-label="Pattern drill" onClick={() => void patternDrill(row.publicId)} title="Pattern drill" type="button"><WandSparkles size={16} /></button>
            <button aria-label="Edit" onClick={() => beginEdit(row)} type="button"><Pencil size={16} /></button>
            <button aria-label="Delete" onClick={() => void deleteItem(row.publicId)} type="button"><Trash2 size={16} /></button></div> : null}</article>)}
      </div></section></div>
  </main>;
}
