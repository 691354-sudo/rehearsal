import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { apiPath } from "../lib/api";

type Language = "en" | "lv";
type LearningItem = { publicId: string; target: string; cue: string };
type TopicSummary = {
  publicId: string;
  language: Language;
  title: string;
  description: string;
  itemCount: number;
};
type Topic = TopicSummary & { items: LearningItem[] };

export function TopicsManager({ language }: { language: Language }) {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [title, setTitle] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const loadTopic = async (publicId: string) => {
    const response = await fetch(apiPath(`/api/islands/${publicId}`));
    if (!response.ok) throw new Error("Topic could not be loaded.");
    const data = await response.json() as { island: Topic };
    setTopic(data.island); setTitle(data.island.title);
  };
  const load = async (preferredId?: string) => {
    const [topicResponse, itemResponse] = await Promise.all([
      fetch(apiPath(`/api/islands?language=${language}`)),
      fetch(apiPath(`/api/items?language=${language}&limit=500`)),
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
      const response = await fetch(apiPath("/api/islands"), {
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
      const response = await fetch(apiPath(`/api/islands/${topic.publicId}`), {
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
    const response = await fetch(apiPath(`/api/islands/${topic.publicId}`), { method: "DELETE" });
    if (response.ok) { setTopic(null); await load(); setNotice("Topic deleted. Its cards were not deleted."); }
    else setNotice("Topic could not be deleted.");
    setSaving(false);
  };
  const move = (index: number, direction: -1 | 1) => {
    if (!topic) return;
    const next = [...topic.items]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void update({ itemIds: next.map((item) => item.publicId) });
  };
  const availableItems = useMemo(() => {
    const current = new Set(topic?.items.map((item) => item.publicId));
    return items.filter((item) => !current.has(item.publicId));
  }, [items, topic?.items]);

  return <section className="topics-manager">
    <header><div><h2>Topics</h2><span>Reusable groups for filtering cards. Cards can belong to more than one.</span></div>
      <div><input aria-label="New Topic name" onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void create(); }
      }} placeholder="New Topic" value={newTitle} /><button disabled={!newTitle.trim() || saving} onClick={() => void create()} type="button"><Plus size={15} />Create</button></div></header>
    <div className="topics-layout">
      <nav aria-label="Topics">{topics.map((candidate) => <button className={candidate.publicId === topic?.publicId ? "is-active" : ""}
        key={candidate.publicId} onClick={() => void loadTopic(candidate.publicId)} type="button"><span>{candidate.title}</span><small>{candidate.itemCount}</small></button>)}</nav>
      <div className="topic-detail">
        {!topic ? <div className="topic-empty">Create a Topic or choose one from the list.</div> : <>
          <div className="topic-title-edit"><input aria-label="Topic name" onChange={(event) => setTitle(event.target.value)} value={title} />
            <button disabled={saving || !title.trim() || title.trim() === topic.title} onClick={() => void update({ title: title.trim() })} type="button"><Save size={14} />Rename</button>
            <button aria-label="Delete Topic" disabled={saving} onClick={() => void remove()} type="button"><Trash2 size={14} /></button></div>
          <div className="topic-items">{topic.items.map((item, index) => <article key={item.publicId}><div><strong>{item.target}</strong><span>{item.cue}</span></div>
            <div><button aria-label="Move up" disabled={saving || index === 0} onClick={() => move(index, -1)} type="button"><ArrowUp size={14} /></button>
              <button aria-label="Move down" disabled={saving || index === topic.items.length - 1} onClick={() => move(index, 1)} type="button"><ArrowDown size={14} /></button>
              <button aria-label="Remove from Topic" disabled={saving} onClick={() => void update({ itemIds: topic.items.filter((candidate) => candidate.publicId !== item.publicId).map((candidate) => candidate.publicId) })} type="button"><X size={14} /></button></div></article>)}</div>
          <div className="topic-add-item"><select aria-label="Add card to Topic" disabled={!availableItems.length} onChange={(event) => setAddItemId(event.target.value)} value={addItemId}>
            <option value="">{availableItems.length ? "Choose a card…" : "All cards are already here"}</option>{availableItems.map((item) => <option key={item.publicId} value={item.publicId}>{item.target}</option>)}</select>
            <button disabled={!addItemId || saving} onClick={() => { if (!topic || !addItemId) return; void update({ itemIds: [...topic.items.map((item) => item.publicId), addItemId] }); setAddItemId(""); }} type="button">{saving ? <LoaderCircle className="simple-spin" size={14} /> : <Plus size={14} />}Add</button></div>
        </>}
      </div>
    </div>
    {notice ? <p aria-live="polite">{notice}</p> : null}
  </section>;
}
