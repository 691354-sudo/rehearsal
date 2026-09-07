import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowDown, Check, ChevronRight, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language, LearningItem } from "../../shared/contracts";
import { normalizeNfc } from "../../../contracts/text";
import { LikedTopicDetail } from "../pilot/LikedTopicDetail";
import { TopicCards } from "./TopicCards";
import { getTopic, getTopics, mergeTopics, moveTopicCards, saveTopic } from "./topicRequests";

type Screen = "list" | "detail" | "create" | "rename" | "add" | "move" | "merge" | "confirm-merge" | "delete";
const normalized = (value: string) => normalizeNfc(value.trim()).toLocaleLowerCase();
const cardCount = (count: number) => `${count} ${count === 1 ? "card" : "cards"}`;

export function TopicsManager({ initialTopicId, language, onClose, onCreateNew, onEdit, onItemDeleted, onTopic }: {
  initialTopicId: string;
  language: Language;
  onClose: () => void;
  onCreateNew: () => void;
  onEdit: (itemId: string) => void;
  onItemDeleted: (itemId: string) => void;
  onTopic: (topicId: string) => void;
}) {
  const [topics, setTopics] = useState<IslandSummary[]>([]);
  const [topic, setTopic] = useState<Island | null>(null);
  const [screen, setScreen] = useState<Screen>(initialTopicId ? "detail" : "list");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshPendingId, setRefreshPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destinationId, setDestinationId] = useState("");
  const [movedTo, setMovedTo] = useState("");
  const [otherItems, setOtherItems] = useState<LearningItem[]>([]);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [visibleCount, setVisibleCount] = useState(20);
  const heading = useRef<HTMLHeadingElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const changeScreen = (next: Screen) => { setScreen(next); setQuery(""); setError(""); setNotice(""); setMovedTo(""); setVisibleCount(20); };
  const report = (failure: unknown) => setError(failure instanceof Error ? failure.message : "Couldn’t save this change. Try again.");
  const refresh = async (id?: string) => {
    const [nextTopics, nextTopic] = await Promise.all([getTopics(language), id ? getTopic(id) : null]);
    setTopics(nextTopics); setTopic(nextTopic); setRefreshPendingId(null);
    return nextTopic;
  };
  const openTopic = async (id: string) => {
    const request = ++requestId.current;
    setLoading(true); setError("");
    try {
      const next = await getTopic(id);
      if (request !== requestId.current) return;
      setTopic(next); setRefreshPendingId(null); setSelecting(false); setSelected(new Set()); setNotice(""); setMovedTo("");
      changeScreen("detail"); onTopic(id);
    } catch (failure) { if (request === requestId.current) report(failure); }
    finally { if (request === requestId.current) setLoading(false); }
  };
  const loadInitial = async () => {
    setLoading(true); setError("");
    try { await refresh(initialTopicId || undefined); }
    catch (failure) { report(failure); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadInitial(); return () => { requestId.current++; }; }, [language]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (screen === "create" || screen === "rename") nameInput.current?.focus();
      else heading.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [screen]);

  const back = () => {
    if (saving) return;
    if ((screen === "create" && name.trim() || screen === "rename" && name.trim() !== topic?.title) && !window.confirm("Discard the unsaved Topic name?")) return;
    if (screen === "list") { onClose(); return; }
    if (screen === "confirm-merge") { changeScreen("merge"); return; }
    if (screen === "detail" || screen === "create") {
      if (topic?.publicId === "liked") void refresh().catch(report);
      changeScreen("list"); setTopic(null); setSelecting(false); setSelected(new Set()); onTopic("");
    } else changeScreen("detail");
  };
  const finish = async (id: string, message: string, destination = "") => {
    // The write is already confirmed. A refresh failure must not invite another write.
    changeScreen("detail"); setSelecting(false); setSelected(new Set()); setMovedTo(destination); setNotice(message); onTopic(id);
    try { await refresh(id); } catch { setRefreshPendingId(id); setError("Change saved, but the list could not refresh. Reload topics before making another change."); }
  };
  const saveName = async () => {
    if (!name.trim() || duplicate || saving) return;
    setSaving(true); setError("");
    try {
      let next: Island;
      if (screen === "rename" && topic) next = await saveTopic(topic.publicId, { title: name.trim() });
      else {
        const response = await apiFetch("/api/islands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language, title: name.trim(), itemIds: [] }) });
        if (!response.ok) throw new Error(response.status === 409 ? "A Topic with this name already exists." : "Topic could not be created. Try again.");
        next = (await response.json()).island;
      }
      setTopic(next); await finish(next.publicId, screen === "rename" ? "Topic renamed." : "Topic created.");
    } catch (failure) { report(failure); }
    finally { setSaving(false); }
  };
  const startAdd = async () => {
    if (!topic) return;
    changeScreen("add"); setSelected(new Set()); setLoading(true);
    try {
      const all = await Promise.all(topics.filter((candidate) => candidate.publicId !== "liked" && candidate.publicId !== topic.publicId).map((candidate) => getTopic(candidate.publicId)));
      setOtherItems(all.flatMap((candidate) => candidate.items));
      setSources(Object.fromEntries(all.flatMap((candidate) => candidate.items.map((item) => [item.publicId, candidate.title]))));
    } catch (failure) { report(failure); }
    finally { setLoading(false); }
  };
  const move = async () => {
    if (!topic || !selected.size || saving) return;
    const target = screen === "add" ? topic : destination;
    if (!target) return;
    setSaving(true); setError("");
    try {
      await moveTopicCards(target.publicId, [...selected]);
      await finish(topic.publicId, `Moved ${cardCount(selected.size)} to ${target.title}.`, target.publicId === topic.publicId ? "" : target.publicId);
    } catch (failure) { report(failure); }
    finally { setSaving(false); }
  };
  const merge = async () => {
    if (!topic || !destination || saving) return;
    setSaving(true); setError("");
    try {
      const result = await mergeTopics(topic.publicId, destination.publicId);
      if (result.sourceRemoved) await finish(destination.publicId, `Merged into ${destination.title}.`);
      else await finish(topic.publicId, `Cards moved to ${destination.title}. The source Topic could not be removed; check its remaining cards before deleting it.`, destination.publicId);
    } catch (failure) { report(failure); }
    finally { setSaving(false); }
  };
  const removeTopic = async () => {
    if (!topic || saving) return;
    setSaving(true); setError("");
    try {
      const response = await apiFetch(`/api/islands/${topic.publicId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Topic could not be deleted. Try again.");
      topic.items.forEach((item) => onItemDeleted(item.publicId));
      const message = `Topic and ${cardCount(topic.items.length)} deleted.`;
      setTopic(null); onTopic(""); changeScreen("list"); setNotice(message);
      try { await refresh(); } catch { setRefreshPendingId(""); setError("Topic deleted, but the list could not refresh. Reload topics."); }
    } catch (failure) { report(failure); }
    finally { setSaving(false); }
  };
  const deleteCards = async (ids: string[]) => {
    if (!topic || !ids.length || saving || !window.confirm(`Delete ${cardCount(ids.length)} from Library and their review history?`)) return;
    setSaving(true); setError("");
    try {
      const response = await apiFetch("/api/items", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemIds: ids }) });
      if (!response.ok) throw new Error("Cards could not be deleted. Try again.");
      const data = await response.json() as { deleted: string[] };
      data.deleted.forEach(onItemDeleted);
      await finish(topic.publicId, `${cardCount(data.deleted.length)} deleted.`);
    } catch (failure) { report(failure); }
    finally { setSaving(false); }
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const destination = topics.find((candidate) => candidate.publicId === destinationId);
  const duplicate = topics.find((candidate) => normalized(candidate.title) === normalized(name) && !(screen === "rename" && candidate.publicId === topic?.publicId));
  const choosingDestination = screen === "move" || screen === "merge";
  const topicOptions = topics.filter((candidate) => (!choosingDestination || candidate.publicId !== "liked" && candidate.publicId !== topic?.publicId) && normalized(candidate.title).includes(normalized(screen === "list" ? listQuery : query)));
  const matchingItems = otherItems.filter((item) => normalized(`${item.target} ${item.cue} ${sources[item.publicId] || ""}`).includes(normalized(query)));
  const title = screen === "list" ? "Manage topics" : screen === "detail" ? "Topics" : screen === "create" ? "New topic" : screen === "rename" ? "Rename topic"
    : screen === "add" ? "Add cards" : screen === "move" ? `Move ${cardCount(selected.size)}` : screen === "delete" ? "Delete topic" : "Merge topics";
  const busy = saving || loading;
  const primary = (label: string, action: () => void, disabled = false) => <button className="simple-primary" disabled={disabled || busy} onClick={action} type="button">
    {saving ? <LoaderCircle className="simple-spin" aria-hidden="true" size={16} /> : null}{label}</button>;

  return <section className="topics-manager topics-flow" aria-busy={busy}>
    <header className="topics-flow-header"><button className="topic-icon" aria-label={screen === "list" ? "Back to Library" : "Back"} disabled={busy} onClick={back} type="button"><ArrowLeft aria-hidden="true" size={18} /></button>
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
      {screen === "list" ? <button className="topic-icon" aria-label="New topic" disabled={busy} onClick={() => { setName(""); changeScreen("create"); }} type="button"><Plus aria-hidden="true" size={18} /></button> : null}
      {screen === "detail" && topic && topic.publicId !== "liked" && !selecting ? <details className="topic-actions" onKeyDown={(event) => {
        if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
      }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
        <summary aria-label="More Topic actions"><MoreHorizontal aria-hidden="true" size={18} /></summary><div onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.closest("details")!.open = false; }}>
          <button disabled={busy} onClick={() => { setName(topic.title); changeScreen("rename"); }} type="button"><Pencil aria-hidden="true" size={16} />Rename</button>
          <button disabled={busy || topics.length < 2} onClick={() => { setDestinationId(""); changeScreen("merge"); }} type="button">Merge into…</button>
          <button className="topic-danger" disabled={busy} onClick={() => changeScreen("delete")} type="button"><Trash2 aria-hidden="true" size={16} />Delete topic</button>
        </div></details> : null}
    </header>
    {error ? <div className="topic-feedback topic-error" role="alert"><p>{error}</p>{!saving ? <button onClick={() => { if (screen === "add") void startAdd(); else { setLoading(true); void refresh(refreshPendingId ?? topic?.publicId ?? (initialTopicId || undefined)).then(() => setError("")).catch(report).finally(() => setLoading(false)); } }} type="button">Reload topics</button> : null}</div> : null}
    {notice ? <div className="topic-feedback" role="status"><p>{notice}</p>{movedTo ? <button disabled={busy} onClick={() => void openTopic(movedTo)} type="button">Open destination<ChevronRight aria-hidden="true" size={16} /></button> : null}</div> : null}
    {loading || refreshPendingId !== null ? <p className="topic-loading" role="status">{loading ? "Loading topics…" : "Reload to show the saved changes."}</p> : <>
      <div className="topics-flow-body">
        {screen === "list" || choosingDestination ? <>
          <p className="topic-meta">{screen === "list" ? `${topics.length} topics` : <>From <strong>{topic?.title}</strong></>}</p>
          <label className="topic-search"><span>{choosingDestination ? "Destination topic" : "Search topics"}</span><input type="search" name="topic-search" autoComplete="off" placeholder={choosingDestination ? "Find a topic…" : "Search topics…"}
            value={screen === "list" ? listQuery : query} onChange={(event) => screen === "list" ? setListQuery(event.target.value) : setQuery(event.target.value)} /></label>
          <ul className="topic-browser">{topicOptions.map((candidate) => <li key={candidate.publicId}><button disabled={saving} aria-pressed={choosingDestination ? destinationId === candidate.publicId : undefined}
            onClick={() => choosingDestination ? setDestinationId(candidate.publicId) : void openTopic(candidate.publicId)} type="button"><strong>{candidate.title}</strong><small>{cardCount(candidate.itemCount)}</small>
            {choosingDestination && destinationId === candidate.publicId ? <Check aria-hidden="true" size={18} /> : <ChevronRight aria-hidden="true" size={18} />}</button></li>)}</ul>
          {!topicOptions.length ? <div className="topic-empty"><p>{topics.length ? "No matching topics." : "Create your first Topic, then add cards to it."}</p>
            {topics.length ? <button onClick={() => { setQuery(""); setListQuery(""); }} type="button">Clear search</button> : primary("New topic", () => { setName(""); changeScreen("create"); })}</div> : null}
        </> : null}
        {screen === "create" || screen === "rename" ? <form id="topic-name-form" onSubmit={(event) => { event.preventDefault(); void saveName(); }}>
          <label className="topic-name"><span>Topic name</span><input ref={nameInput} name="topic-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} aria-invalid={Boolean(duplicate)} aria-describedby={duplicate ? "topic-duplicate" : undefined} /></label>
          <p className="topic-meta">{screen === "rename" ? "Cards and practice history stay with this Topic." : "You can add or move cards after creating the Topic."}</p>
          {duplicate ? <p id="topic-duplicate" role="status">A Topic with this name already exists. <button type="button" onClick={() => void openTopic(duplicate.publicId)}>Open topic</button></p> : null}
        </form> : null}
        {screen === "detail" && topic?.publicId === "liked" ? <LikedTopicDetail topic={topic} visibleCount={visibleCount} onMore={() => setVisibleCount((count) => count + 20)} onEdit={onEdit} /> : null}
        {screen === "detail" && topic && topic.publicId !== "liked" ? <>
          <h3>{topic.title}</h3><p className="topic-meta">{cardCount(topic.items.length)}</p>
          <div className="topic-toolbar">{selecting ? <><label><input type="checkbox" checked={Boolean(topic.items.length) && selected.size === topic.items.length} disabled={saving}
            onChange={() => setSelected(selected.size === topic.items.length ? new Set() : new Set(topic.items.map((item) => item.publicId)))} />Select all</label>
            <button disabled={saving} onClick={() => { setSelecting(false); setSelected(new Set()); }} type="button">Cancel</button></> : <><button onClick={() => void startAdd()} type="button"><Plus aria-hidden="true" size={16} />Add cards</button>
              <button disabled={!topic.items.length} onClick={() => { setSelecting(true); setSelected(new Set()); }} type="button">Select</button></>}</div>
          <TopicCards items={topic.items.slice(0, visibleCount)} language={language} selected={selecting ? selected : undefined} onToggle={toggle} onEdit={onEdit} onDelete={(id) => void deleteCards([id])} disabled={saving} />
          {visibleCount < topic.items.length ? <button onClick={() => setVisibleCount((count) => count + 20)} type="button">Show 20 more</button> : null}
          {!topic.items.length ? <p className="topic-empty">No cards in this Topic yet.</p> : null}
        </> : null}
        {screen === "add" && topic ? <><p className="topic-meta">Move cards from their current topics to <strong>{topic.title}</strong>.</p><button onClick={onCreateNew} type="button"><Plus aria-hidden="true" size={16} />Create a new card</button>
          <label className="topic-search"><span>Search cards</span><input name="topic-card-search" type="search" autoComplete="off" placeholder="Search phrase, cue or topic…" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(20); }} /></label>
          <TopicCards items={matchingItems.slice(0, visibleCount)} language={language} selected={selected} onToggle={toggle} disabled={saving} sources={sources} />
          {!matchingItems.length ? <p className="topic-empty">{otherItems.length ? "No matching cards." : "No other cards in Library."}</p> : null}
          {visibleCount < matchingItems.length ? <button onClick={() => setVisibleCount((count) => count + 20)} type="button">Show 20 more</button> : null}
        </> : null}
        {screen === "confirm-merge" && topic && destination ? <><div className="topic-transfer-summary"><strong>{topic.title}<small>{cardCount(topic.items.length)}</small></strong><ArrowDown size={20} /><strong>{destination.title}<small>{cardCount(destination.itemCount)}</small></strong></div>
          <h3>{cardCount(topic.items.length + destination.itemCount)} in {destination.title}</h3><p>Move all cards, then remove the empty Topic “{topic.title}”. Card content and practice history stay intact.</p><p className="topic-meta">This does not find or delete duplicate sentences.</p></> : null}
        {screen === "delete" && topic ? <><h3>Delete “{topic.title}”?</h3><p>This also deletes its {cardCount(topic.items.length)} and their review history.</p><p className="topic-meta">To keep the cards, move them to another Topic first.</p></> : null}
      </div>
      {screen === "create" || screen === "rename" ? <footer className="topics-flow-footer"><button form="topic-name-form" className="simple-primary" disabled={saving || !name.trim() || Boolean(duplicate) || (screen === "rename" && name.trim() === topic?.title)} type="submit">{saving ? "Saving…" : screen === "create" ? "Create topic" : "Save name"}</button></footer> : null}
      {screen === "detail" && selecting ? <footer className="topics-flow-footer"><span>{selected.size} selected</span>{primary(`Move ${cardCount(selected.size)}`, () => { setDestinationId(""); changeScreen("move"); }, !selected.size || topics.length < 2)}
        <button className="topic-danger" disabled={saving || !selected.size} onClick={() => void deleteCards([...selected])} type="button">Delete selected</button></footer> : null}
      {screen === "move" || screen === "add" ? <footer className="topics-flow-footer"><span>{selected.size} selected</span>{primary(screen === "add" ? `Move ${cardCount(selected.size)} here` : destination ? `Move to ${destination.title}` : "Choose a topic", () => void move(), !selected.size || (screen === "move" && !destination))}</footer> : null}
      {screen === "merge" ? <footer className="topics-flow-footer">{primary("Continue", () => changeScreen("confirm-merge"), !destination)}</footer> : null}
      {screen === "confirm-merge" ? <footer className="topics-flow-footer">{primary("Merge topics", () => void merge())}</footer> : null}
      {screen === "delete" ? <footer className="topics-flow-footer"><button onClick={back} disabled={saving} type="button">Keep topic</button><button className="topic-danger" disabled={saving} onClick={() => void removeTopic()} type="button">{saving ? "Deleting…" : `Delete topic and ${cardCount(topic?.items.length || 0)}`}</button></footer> : null}
    </>}
  </section>;
}
