import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Headphones, LoaderCircle, MoreHorizontal, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { apiFetch } from "../../shared/api";
import type { IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { normalizeNfc } from "../../../contracts/text";
import { FocusedText } from "../progress/FocusedText";
import { LearningProgressBadge, LearningStageBadge } from "../progress/LearningProgress";

type TopicSummary = IslandSummary;
type Topic = TopicSummary & { items: LearningItem[] };

export function TopicsManager({ initialTopicId, language, onClose, onCreateNew, onEdit, onTopic }: {
  initialTopicId: string;
  language: Language;
  onClose: () => void;
  onCreateNew: () => void;
  onEdit: (itemId: string) => void;
  onTopic: (topicId: string) => void;
}) {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [title, setTitle] = useState("");
  const [selectedAddItemIds, setSelectedAddItemIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [moveTargetId, setMoveTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [visibleItemCount, setVisibleItemCount] = useState(20);
  const activeTopicRef = useRef<HTMLButtonElement>(null);
  const topicMenuButtonRef = useRef<HTMLButtonElement>(null);

  const loadTopic = async (publicId: string) => {
    const response = await apiFetch(`/api/islands/${publicId}`);
    if (!response.ok) throw new Error("Topic could not be loaded.");
    const data = await response.json() as { island: Topic };
    setTopic(data.island); setTitle(data.island.title); setRenaming(false); setAddingCard(false); setTopicMenuOpen(false); setSelectionMode(false); setMerging(false);
    setSelectedAddItemIds(new Set()); setSelectedItemIds(new Set()); setMoveTargetId(""); setMergeTargetId(""); onTopic(data.island.publicId);
  };
  const load = async (preferredId?: string) => {
    const [topicResponse, itemResponse] = await Promise.all([
      apiFetch(`/api/islands?language=${language}`),
      apiFetch(`/api/items?language=${language}&limit=2000&includeSchedule=true`),
    ]);
    if (!topicResponse.ok || !itemResponse.ok) throw new Error("Topics could not be loaded.");
    const topicData = await topicResponse.json() as { islands: TopicSummary[] };
    const itemData = await itemResponse.json() as { items: LearningItem[] };
    setTopics(topicData.islands); setItems(itemData.items);
    const selectedId = preferredId || (topicData.islands.some((candidate) => candidate.publicId === topic?.publicId)
      ? topic?.publicId : topicData.islands[0]?.publicId);
    if (selectedId) await loadTopic(selectedId); else { setTopic(null); setTitle(""); }
  };

  useEffect(() => {
    setTopics([]); setTopic(null); setNewTitle(""); setNotice("");
    void load(initialTopicId || undefined).catch((error) => setNotice(error instanceof Error ? error.message : "Topics could not be loaded."));
  }, [language]);
  useEffect(() => {
    if (!topic || !window.matchMedia("(max-width: 480px)").matches) return;
    window.requestAnimationFrame(() => activeTopicRef.current?.scrollIntoView({ block: "nearest", inline: "center" }));
  }, [topic?.publicId]);

  const create = async () => {
    const nextTitle = newTitle.trim(); if (!nextTitle || saving) return;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/islands", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, title: nextTitle, itemIds: [] }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "A Topic with this name already exists." : "Topic could not be created.");
      const data = await response.json() as { island: Topic };
      setNewTitle(""); await load(data.island.publicId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Topic could not be created."); }
    finally { setSaving(false); }
  };
  const update = async (patch: { title?: string; itemIds?: string[] }) => {
    if (!topic || saving) return false;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch(`/api/islands/${topic.publicId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "A Topic with this name already exists." : "Topic could not be updated.");
      const data = await response.json() as { island: Topic };
      setTopic(data.island); setTitle(data.island.title); await load(data.island.publicId);
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Topic could not be updated."); return false; }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!topic || !window.confirm(`Delete Topic “${topic.title}”? Its cards will stay in Library and Recall.`)) return;
    setSaving(true); setNotice("");
    const response = await apiFetch(`/api/islands/${topic.publicId}`, { method: "DELETE" });
    if (response.ok) { setTopic(null); onTopic(""); await load(); setNotice("Topic deleted. Its cards were not deleted."); }
    else setNotice("Topic could not be deleted.");
    setSaving(false);
  };
  const merge = async () => {
    if (!topic || !mergeTargetId || saving) return;
    const destination = topics.find((candidate) => candidate.publicId === mergeTargetId);
    if (!destination || !window.confirm(`Merge “${topic.title}” into “${destination.title}”? Cards will move and “${topic.title}” will be deleted.`)) return;
    setSaving(true); setNotice("");
    try {
      const targetResponse = await apiFetch(`/api/islands/${mergeTargetId}`);
      if (!targetResponse.ok) throw new Error("Destination Topic could not be loaded.");
      const targetData = await targetResponse.json() as { island: Topic };
      const itemIds = [...new Set([...targetData.island.items.map((item) => item.publicId), ...topic.items.map((item) => item.publicId)])];
      const updateResponse = await apiFetch(`/api/islands/${mergeTargetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds }),
      });
      if (!updateResponse.ok) throw new Error("Topics could not be merged.");
      const deleteResponse = await apiFetch(`/api/islands/${topic.publicId}`, { method: "DELETE" });
      if (!deleteResponse.ok) {
        setNotice(`Cards were added to ${destination.title}, but ${topic.title} could not be deleted.`);
        await load(topic.publicId);
      } else {
        setTopic(null); onTopic(""); await load(destination.publicId);
        setNotice(`Merged into ${destination.title}.`);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Topics could not be merged."); }
    finally { setSaving(false); }
  };
  const moveSelected = async () => {
    if (!topic || !moveTargetId || !selectedItemIds.size || saving) return;
    const selectedItems = topic.items.filter((item) => selectedItemIds.has(item.publicId));
    const destination = topics.find((candidate) => candidate.publicId === moveTargetId);
    setSaving(true); setNotice("");
    try {
      const targetResponse = await apiFetch(`/api/islands/${moveTargetId}`);
      if (!targetResponse.ok) throw new Error("Destination Topic could not be loaded.");
      const targetData = await targetResponse.json() as { island: Topic };
      const targetItemIds = [...new Set([...targetData.island.items.map((candidate) => candidate.publicId), ...selectedItems.map((item) => item.publicId)])];
      const addResponse = await apiFetch(`/api/islands/${moveTargetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: targetItemIds }),
      });
      if (!addResponse.ok) throw new Error("Cards could not be moved.");
      const removeResponse = await apiFetch(`/api/islands/${topic.publicId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: topic.items.filter((item) => !selectedItemIds.has(item.publicId)).map((item) => item.publicId) }),
      });
      if (!removeResponse.ok) {
        setNotice(`Added ${selectedItems.length} cards to ${destination?.title || "the destination"}, but they are still in ${topic.title}.`);
      } else {
        setNotice(`Moved ${selectedItems.length} ${selectedItems.length === 1 ? "card" : "cards"} to ${destination?.title || "another Topic"}.`);
      }
      await load(topic.publicId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Cards could not be moved."); }
    finally { setSaving(false); }
  };
  const removeSelected = async () => {
    if (!topic || !selectedItemIds.size || saving) return;
    const count = selectedItemIds.size;
    const updated = await update({ itemIds: topic.items.filter((item) => !selectedItemIds.has(item.publicId)).map((item) => item.publicId) });
    if (updated) setNotice(`Removed ${count} ${count === 1 ? "card" : "cards"} from this Topic.`);
  };
  const toggleSelected = (itemId: string) => setSelectedItemIds((current) => {
    const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next;
  });
  const toggleAddItem = (itemId: string) => setSelectedAddItemIds((current) => {
    const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next;
  });
  const availableItems = useMemo(() => {
    const current = new Set(topic?.items.map((item) => item.publicId));
    return items.filter((item) => !current.has(item.publicId));
  }, [items, topic?.items]);
  const matchingItems = useMemo(() => {
    const normalized = normalizeNfc(itemSearch.trim()).toLocaleLowerCase();
    if (!normalized) return availableItems;
    return availableItems.filter((item) => normalizeNfc(`${item.target} ${item.cue}`).toLocaleLowerCase().includes(normalized));
  }, [availableItems, itemSearch]);
  const visibleItems = matchingItems.slice(0, visibleItemCount);

  return <section className="topics-manager">
    <header><div><h2>Manage topics</h2><span>{topics.length} topics</span></div>
      <div className="topics-header-actions"><div className="topic-create"><input aria-label="New Topic name" autoComplete="off" name="new-topic" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void create(); }
      }} placeholder="New topic…" value={newTitle} /><button aria-label="Create topic" disabled={!newTitle.trim() || saving} onClick={() => void create()} title="Create topic" type="button"><Plus size={17} /></button></div>
        <button aria-label="Close Topic manager" className="topic-manager-close" onClick={onClose} type="button"><X size={16} /></button></div></header>
    <div className="topics-layout">
      <nav aria-label="Topics">{topics.map((candidate) => {
        return <button className={candidate.publicId === topic?.publicId ? "is-active" : ""}
        key={candidate.publicId} onClick={() => void loadTopic(candidate.publicId)} ref={candidate.publicId === topic?.publicId ? activeTopicRef : undefined}
        title={candidate.title} type="button"><span><b>{candidate.title}</b></span>
          <small>{candidate.itemCount}</small></button>;
      })}</nav>
      <div className="topic-detail">
        {!topic ? <div className="topic-empty">Create or select a Topic.</div> : <>
          <div className="topic-detail-heading">{renaming ? <div className="topic-title-edit"><input aria-label="Topic name" autoComplete="off" name="topic-name" onChange={(event) => setTitle(event.target.value)} value={title} />
            <button disabled={saving || !title.trim() || title.trim() === topic.title} onClick={() => void update({ title: title.trim() })} type="button"><Save size={14} />Save</button>
            <button onClick={() => { setTitle(topic.title); setRenaming(false); }} type="button">Cancel</button></div>
          : <div className="topic-title-summary"><h3>{topic.title}</h3><small>{topic.items.length} {topic.items.length === 1 ? "card" : "cards"}</small></div>}
            {!renaming ? <div>{selectionMode ? <button onClick={() => { setSelectionMode(false); setSelectedItemIds(new Set()); setMoveTargetId(""); }} type="button">Cancel selection</button> : <>
              <button className={addingCard ? "" : "topic-add-toggle"} onClick={() => { setAddingCard((active) => !active); setSelectedAddItemIds(new Set()); setItemSearch(""); setVisibleItemCount(20); setTopicMenuOpen(false); }} type="button">{addingCard ? <X size={14} /> : <Plus size={14} />}{addingCard ? "Close" : "Add cards"}</button>
              <button disabled={!topic.items.length || saving} onClick={() => { setAddingCard(false); setTopicMenuOpen(false); setSelectionMode(true); setSelectedItemIds(new Set()); setMoveTargetId(""); }} type="button">Select</button>
              <div className="topic-overflow"><button aria-expanded={topicMenuOpen} aria-haspopup="menu" aria-label="More Topic actions" onClick={() => setTopicMenuOpen((open) => !open)} ref={topicMenuButtonRef} type="button"><MoreHorizontal size={16} /></button>
                {topicMenuOpen ? <div className="topic-overflow-menu" onKeyDown={(event) => { if (event.key === "Escape") { setTopicMenuOpen(false); window.requestAnimationFrame(() => topicMenuButtonRef.current?.focus()); } }} role="menu"><button onClick={() => { setAddingCard(false); setTopicMenuOpen(false); setRenaming(true); }} role="menuitem" type="button"><Pencil size={14} />Rename</button>
                  <button disabled={saving || topics.length < 2} onClick={() => { setTopicMenuOpen(false); setMerging(true); setMergeTargetId(""); }} role="menuitem" type="button">Merge into…</button>
                  <button className="topic-delete" disabled={saving} onClick={() => { setTopicMenuOpen(false); void remove(); }} role="menuitem" type="button"><Trash2 size={14} />Delete</button></div> : null}</div></>}</div> : null}</div>
          {merging ? <div className="topic-merge"><span>Move every card, then remove this duplicate Topic.</span><select aria-label="Merge into Topic" onChange={(event) => setMergeTargetId(event.target.value)} value={mergeTargetId}>
            <option value="">Merge into…</option>{topics.filter((candidate) => candidate.publicId !== topic.publicId).map((candidate) => <option key={candidate.publicId} value={candidate.publicId}>{candidate.title}</option>)}</select>
            <button disabled={!mergeTargetId || saving} onClick={() => void merge()} type="button">Merge</button>
            <button onClick={() => { setMerging(false); setMergeTargetId(""); }} type="button">Cancel</button></div> : null}
          {addingCard ? <section className="topic-add-item"><div><div><strong>Add cards</strong><span>Choose from Library or create directly in {topic.title}.</span></div>
            <button onClick={onCreateNew} type="button"><Plus size={14} />Create new</button></div>
            <label htmlFor="topic-card-search">Search cards</label>
            <input autoComplete="off" id="topic-card-search" name="topic-card-search" onChange={(event) => { setItemSearch(event.target.value); setVisibleItemCount(20); }}
              placeholder="Search target or Russian cue…" type="search" value={itemSearch} />
            <div className="topic-card-picker" aria-label="Library cards">
              {!visibleItems.length ? <span>{availableItems.length ? "No matching cards" : "All cards are already here"}</span> : visibleItems.map((item) => <button
                aria-pressed={selectedAddItemIds.has(item.publicId)} className={selectedAddItemIds.has(item.publicId) ? "is-selected" : ""} key={item.publicId}
                onClick={() => toggleAddItem(item.publicId)} type="button"><span className="topic-picker-check" aria-hidden="true">{selectedAddItemIds.has(item.publicId) ? <Check size={13} /> : null}</span>
                <span className="topic-picker-copy"><strong lang={language}><FocusedText focusTerms={item.focusTerms} text={item.target} /></strong><small lang="ru">{item.cue}</small>
                  <span className="topic-picker-progress"><LearningStageBadge stage={item.progress.stage} /><span aria-label={`${item.progress.listens} listens`}><Headphones aria-hidden="true" size={12} />{item.progress.listens}</span></span></span></button>)}
              {visibleItemCount < matchingItems.length ? <button className="topic-card-picker-more" onClick={() => setVisibleItemCount((count) => count + 20)} type="button">Show 20 more</button> : null}
            </div>
            <div className="topic-add-footer"><span>{selectedAddItemIds.size} selected</span><button className="simple-primary" disabled={!selectedAddItemIds.size || saving} onClick={() => { if (!topic || !selectedAddItemIds.size) return; void (async () => {
              const count = selectedAddItemIds.size;
              const updated = await update({ itemIds: [...topic.items.map((item) => item.publicId), ...selectedAddItemIds] });
              if (updated) { setSelectedAddItemIds(new Set()); setItemSearch(""); setVisibleItemCount(20); setNotice(`Added ${count} ${count === 1 ? "card" : "cards"} to ${topic.title}.`); }
            })(); }} type="button">
              {saving ? <LoaderCircle className="simple-spin" size={14} /> : <Plus size={14} />}Add selected{selectedAddItemIds.size ? ` (${selectedAddItemIds.size})` : ""}</button></div></section> : null}
          {selectionMode ? <div className="topic-selection-toolbar"><label><input aria-label="Select all cards in this Topic" checked={Boolean(topic.items.length) && topic.items.every((item) => selectedItemIds.has(item.publicId))}
            onChange={() => setSelectedItemIds(topic.items.every((item) => selectedItemIds.has(item.publicId)) ? new Set() : new Set(topic.items.map((item) => item.publicId)))} type="checkbox" /><span>{selectedItemIds.size} selected</span></label>
            <select aria-label="Move selected cards to another Topic" disabled={!selectedItemIds.size || saving || topics.length < 2} onChange={(event) => setMoveTargetId(event.target.value)} value={moveTargetId}>
              <option value="">Move to…</option>{topics.filter((candidate) => candidate.publicId !== topic.publicId).map((candidate) => <option key={candidate.publicId} value={candidate.publicId}>{candidate.title}</option>)}</select>
            <button disabled={!selectedItemIds.size || !moveTargetId || saving} onClick={() => void moveSelected()} type="button">Move</button>
            <button className="topic-remove-selected" disabled={!selectedItemIds.size || saving} onClick={() => void removeSelected()} type="button"><X size={14} />Remove from Topic</button></div> : null}
          <div className="topic-items">{topic.items.length ? topic.items.map((item) => <article className={selectionMode ? "is-selecting" : ""} key={item.publicId}>
            {selectionMode ? <label className="topic-card-select"><input aria-label={`Select ${item.target}`} checked={selectedItemIds.has(item.publicId)} disabled={saving}
              onChange={() => toggleSelected(item.publicId)} type="checkbox" /></label> : null}
            <div className="topic-item-copy"><strong lang={language}><FocusedText focusTerms={item.focusTerms} text={item.target} /></strong><span lang="ru">{item.cue}</span></div>
            <div className="topic-item-side"><LearningProgressBadge progress={item.progress} />
              <button aria-label={`Edit ${item.target}`} className="topic-card-edit" onClick={() => onEdit(item.publicId)} title="Edit card" type="button"><Pencil size={15} /></button></div></article>)
            : <div className="topic-items-empty"><p>No cards in this Topic.</p><div><button className="simple-primary" onClick={onCreateNew} type="button"><Plus size={14} />Create new</button>
              <button onClick={() => { setAddingCard(true); setSelectedAddItemIds(new Set()); setItemSearch(""); setVisibleItemCount(20); }} type="button">Choose from Library</button></div></div>}</div>
        </>}
      </div>
    </div>
    {notice ? <p aria-live="polite">{notice}</p> : null}
  </section>;
}
