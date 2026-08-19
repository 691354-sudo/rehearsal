import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { apiFetch } from "../../shared/api";
import type { Language, LearningItem } from "../../shared/contracts";

type TopicSummary = {
  publicId: string;
  language: Language;
  title: string;
  description: string;
  itemCount: number;
};
type Topic = TopicSummary & { items: LearningItem[] };

export function TopicsManager({ language, onClose }: { language: Language; onClose: () => void }) {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [title, setTitle] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState(false);

  const loadTopic = async (publicId: string) => {
    const response = await apiFetch(`/api/islands/${publicId}`);
    if (!response.ok) throw new Error("Topic could not be loaded.");
    const data = await response.json() as { island: Topic };
    setTopic(data.island); setTitle(data.island.title); setRenaming(false);
  };
  const load = async (preferredId?: string) => {
    const [topicResponse, itemResponse] = await Promise.all([
      apiFetch(`/api/islands?language=${language}`),
      apiFetch(`/api/items?language=${language}&limit=500`),
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
    void load().catch((error) => setNotice(error instanceof Error ? error.message : "Topics could not be loaded."));
  }, [language]);

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
    if (!topic || saving) return;
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch(`/api/islands/${topic.publicId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(response.status === 409 ? "A Topic with this name already exists." : "Topic could not be updated.");
      const data = await response.json() as { island: Topic };
      setTopic(data.island); setTitle(data.island.title); await load(data.island.publicId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Topic could not be updated."); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!topic || !window.confirm(`Delete Topic “${topic.title}”? Its cards will stay in Library and Recall.`)) return;
    setSaving(true); setNotice("");
    const response = await apiFetch(`/api/islands/${topic.publicId}`, { method: "DELETE" });
    if (response.ok) { setTopic(null); await load(); setNotice("Topic deleted. Its cards were not deleted."); }
    else setNotice("Topic could not be deleted.");
    setSaving(false);
  };
  const moveToTopic = async (item: LearningItem, targetId: string) => {
    if (!topic || !targetId || saving) return;
    const destination = topics.find((candidate) => candidate.publicId === targetId);
    setSaving(true); setNotice("");
    try {
      const targetResponse = await apiFetch(`/api/islands/${targetId}`);
      if (!targetResponse.ok) throw new Error("Destination Topic could not be loaded.");
      const targetData = await targetResponse.json() as { island: Topic };
      const targetItemIds = [...new Set([...targetData.island.items.map((candidate) => candidate.publicId), item.publicId])];
      const addResponse = await apiFetch(`/api/islands/${targetId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: targetItemIds }),
      });
      if (!addResponse.ok) throw new Error("Card could not be moved.");
      const removeResponse = await apiFetch(`/api/islands/${topic.publicId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: topic.items.filter((candidate) => candidate.publicId !== item.publicId).map((candidate) => candidate.publicId) }),
      });
      if (!removeResponse.ok) {
        setNotice(`Added to ${destination?.title || "the destination"}, but it is still in ${topic.title}.`);
      } else {
        setNotice(`Moved to ${destination?.title || "another Topic"}.`);
      }
      await load(topic.publicId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Card could not be moved."); }
    finally { setSaving(false); }
  };
  const availableItems = useMemo(() => {
    const current = new Set(topic?.items.map((item) => item.publicId));
    return items.filter((item) => !current.has(item.publicId));
  }, [items, topic?.items]);

  return <section className="topics-manager">
    <header><div><h2>Manage topics</h2><span>{topics.length} Topics</span></div>
      <div className="topics-header-actions"><div className="topic-create"><input aria-label="New Topic name" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void create(); }
      }} placeholder="New Topic" value={newTitle} /><button disabled={!newTitle.trim() || saving} onClick={() => void create()} type="button"><Plus size={15} />Create</button></div>
        <button aria-label="Close Topic manager" className="topic-manager-close" onClick={onClose} type="button"><X size={16} /></button></div></header>
    <div className="topics-layout">
      <nav aria-label="Topics">{topics.map((candidate) => <button className={candidate.publicId === topic?.publicId ? "is-active" : ""}
        key={candidate.publicId} onClick={() => void loadTopic(candidate.publicId)} type="button"><span>{candidate.title}</span><small>{candidate.itemCount}</small></button>)}</nav>
      <div className="topic-detail">
        {!topic ? <div className="topic-empty">Create or select a Topic.</div> : <>
          <div className="topic-detail-heading">{renaming ? <div className="topic-title-edit"><input aria-label="Topic name" autoFocus onChange={(event) => setTitle(event.target.value)} value={title} />
            <button disabled={saving || !title.trim() || title.trim() === topic.title} onClick={() => void update({ title: title.trim() })} type="button"><Save size={14} />Save</button>
            <button onClick={() => { setTitle(topic.title); setRenaming(false); }} type="button">Cancel</button></div>
          : <div><span>Selected Topic</span><h3>{topic.title}</h3><small>{topic.items.length} {topic.items.length === 1 ? "card" : "cards"}</small></div>}
            {!renaming ? <div><button onClick={() => setRenaming(true)} type="button"><Pencil size={14} />Rename</button>
              <button aria-label="Delete Topic" className="topic-delete" disabled={saving} onClick={() => void remove()} title="Delete Topic" type="button"><Trash2 size={14} /></button></div> : null}</div>
          <div className="topic-items">{topic.items.length ? topic.items.map((item) => <article key={item.publicId}><div><strong>{item.target}</strong><span>{item.cue}</span></div>
            <div className="topic-item-actions"><select aria-label={`Move ${item.target} to another Topic`} disabled={saving || topics.length < 2}
              onChange={(event) => { const targetId = event.target.value; event.target.value = ""; void moveToTopic(item, targetId); }} defaultValue="">
                <option value="">Move to…</option>{topics.filter((candidate) => candidate.publicId !== topic.publicId).map((candidate) => <option key={candidate.publicId} value={candidate.publicId}>{candidate.title}</option>)}</select>
              <button className="topic-remove" disabled={saving} onClick={() => void update({ itemIds: topic.items.filter((candidate) => candidate.publicId !== item.publicId).map((candidate) => candidate.publicId) })} type="button"><X size={14} />Remove</button></div></article>)
            : <p className="topic-items-empty">No cards in this Topic.</p>}</div>
          <label className="topic-add-item"><span>Add a Library card to {topic.title}</span><div><select aria-label="Add card to Topic" disabled={!availableItems.length} onChange={(event) => setAddItemId(event.target.value)} value={addItemId}>
            <option value="">{availableItems.length ? "Choose a card…" : "All cards are already here"}</option>{availableItems.map((item) => <option key={item.publicId} value={item.publicId}>{item.target}</option>)}</select>
            <button disabled={!addItemId || saving} onClick={() => { if (!topic || !addItemId) return; void update({ itemIds: [...topic.items.map((item) => item.publicId), addItemId] }); setAddItemId(""); }} type="button">{saving ? <LoaderCircle className="simple-spin" size={14} /> : <Plus size={14} />}Add</button></div></label>
        </>}
      </div>
    </div>
    {notice ? <p aria-live="polite">{notice}</p> : null}
  </section>;
}
