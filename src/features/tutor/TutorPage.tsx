import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, LoaderCircle, PanelLeft, Plus, Send, Upload, X } from "lucide-react";
import { CaptureNotebook } from "../capture/CaptureNotebook";
import type { ProfileId } from "../../../contracts/api";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { apiFetch } from "../../shared/api";
import type { ChatMessage, ChatThread, Language } from "../../shared/contracts";

const renderInlineMarkdown = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
  part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 className="simple-message-heading" key={`heading-${index}`}>{renderInlineMarkdown(heading[1])}</h3>);
      index += 1; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, "")); index += 1;
      }
      nodes.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    nodes.push(<p key={`paragraph-${index}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{renderInlineMarkdown(part)}{partIndex < paragraph.length - 1 ? <br /> : null}</span>)}</p>);
  }
  return <div className="simple-message-copy">{nodes}</div>;
}

const looksLikeVocabList = (content: string) => {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 5 && lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length <= 8;
};

const parseThreadDate = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

const formatThreadDate = (value: string) => {
  const date = parseThreadDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
};

export function TutorPage({ language, profileId }: { language: Language; profileId: ProfileId }) {
  const [tutorMode, setTutorMode] = useState<"chat" | "notebook">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false); const [sessionsOpen, setSessionsOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false); const [reviewBatch, setReviewBatch] = useState<ReviewBatch | null>(null);
  const [threadId, setThreadId] = useState<string>(); const messagesRef = useRef<HTMLDivElement>(null);
  const storageKey = `rehearsal:${profileId}:tutor-thread:${language}`;

  const refreshThreads = async () => {
    const response = await apiFetch(`/api/chat/threads?language=${language}&limit=50`);
    if (!response.ok) throw new Error("Could not load sessions");
    const data = await response.json() as { threads: ChatThread[] };
    setThreads(data.threads || []);
    return data.threads || [];
  };

  const openThread = async (publicId: string) => {
    if (loadingThread || publicId === threadId) { setSessionsOpen(false); return; }
    setLoadingThread(true); setReviewBatch(null);
    try {
      const response = await apiFetch(`/api/chat/${publicId}/messages`);
      if (!response.ok) throw new Error("Could not load session");
      const data = await response.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> };
      setMessages(data.messages.map((message) => ({ ...message, id: crypto.randomUUID() })));
      setThreadId(publicId); window.localStorage.setItem(storageKey, publicId); setSessionsOpen(false);
    } finally { setLoadingThread(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setThreadId(undefined); setReviewBatch(null); setMessages([]); setThreads([]);
    void (async () => {
      try {
        const response = await apiFetch(`/api/chat/threads?language=${language}&limit=50`);
        if (!response.ok) return;
        const data = await response.json() as { threads: ChatThread[] };
        if (cancelled) return;
        const nextThreads = data.threads || []; setThreads(nextThreads);
        const stored = window.localStorage.getItem(storageKey);
        const selected = nextThreads.find((thread) => thread.publicId === stored) || nextThreads[0];
        if (!selected) return;
        const history = await apiFetch(`/api/chat/${selected.publicId}/messages`);
        if (!history.ok || cancelled) return;
        const loaded = await history.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> };
        if (cancelled) return;
        setThreadId(selected.publicId); window.localStorage.setItem(storageKey, selected.publicId);
        setMessages(loaded.messages.map((message) => ({ ...message, id: crypto.randomUUID() })));
      } catch { /* A blank Tutor remains usable when history is unavailable. */ }
    })();
    return () => { cancelled = true; };
  }, [language, profileId]);

  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages, reviewBatch]);

  const newChat = () => {
    setThreadId(undefined); setMessages([]); setReviewBatch(null); setDraft(""); setSessionsOpen(false);
    window.localStorage.removeItem(storageKey);
  };

  const prepareVocab = async (content: string) => {
    const response = await apiFetch("/api/review-batches/vocab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, title: "Vocabulary from Tutor", text: content, threadId }),
    });
    if (!response.ok) throw new Error("Vocab preparation failed");
    const data = await response.json() as { batch: ReviewBatch; threadId: string; content: string };
    setReviewBatch(data.batch); setThreadId(data.threadId); window.localStorage.setItem(storageKey, data.threadId);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.content }]);
  };

  const send = async () => {
    const content = draft.trim(); if (!content || sending) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content }]); setDraft(""); setSending(true);
    try {
      if (looksLikeVocabList(content)) await prepareVocab(content);
      else {
        const response = await apiFetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, message: content, threadId }) });
        if (!response.ok) throw new Error("Chat unavailable");
        const data = await response.json() as { threadId: string; content: string }; setThreadId(data.threadId);
        window.localStorage.setItem(storageKey, data.threadId);
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.content }]);
      }
      await refreshThreads();
    } catch { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "Tutor is unavailable right now. Nothing was added to Library." }]); }
    finally { setSending(false); }
  };

  const finishReview = async () => {
    if (!threadId || reviewing) return; setReviewing(true);
    try {
      const response = await apiFetch(`/api/chat/${threadId}/review`, { method: "POST" });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { batch: ReviewBatch }; setReviewBatch(data.batch);
    } catch { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "Review could not be prepared. Nothing was added to Library." }]); }
    finally { setReviewing(false); }
  };

  const today = new Date().toDateString();
  const currentThread = threads.find((thread) => thread.publicId === threadId);
  const threadGroups = [
    { label: "Today", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() === today) },
    { label: "Earlier", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() !== today) },
  ].filter((group) => group.items.length);

  return <main className={`simple-main ${tutorMode === "chat" ? "simple-main--chat" : "simple-main--notebook"}`}>
    <header className="simple-page-heading simple-tutor-heading"><div className="simple-tutor-title"><h1>Tutor</h1>
      <div aria-label="Tutor mode" className="simple-tutor-mode" role="group">
        <button className={tutorMode === "chat" ? "is-active" : ""} onClick={() => setTutorMode("chat")} type="button">Chat</button>
        <button className={tutorMode === "notebook" ? "is-active" : ""} onClick={() => setTutorMode("notebook")} type="button">Notebook</button>
      </div></div>
      {tutorMode === "chat" ? <div className="simple-tutor-mobile-actions">
        <button onClick={() => setSessionsOpen(true)} type="button"><PanelLeft size={16} />Sessions</button>
        <button aria-label="New chat" onClick={newChat} title="New chat" type="button"><Plus size={17} /></button>
      </div> : null}</header>
    {tutorMode === "notebook" ? <CaptureNotebook language={language} /> : <section className="simple-chat">
      {sessionsOpen ? <button aria-label="Close sessions" className="simple-session-backdrop" onClick={() => setSessionsOpen(false)} type="button" /> : null}
      <aside className={`simple-session-rail ${sessionsOpen ? "is-open" : ""}`}>
        <div className="simple-session-rail-heading"><strong>Sessions</strong>
          <button aria-label="Close sessions" onClick={() => setSessionsOpen(false)} type="button"><X size={16} /></button></div>
        <button className="simple-new-chat" onClick={newChat} type="button"><Plus size={16} />New chat</button>
        <nav aria-label="Tutor sessions">{threadGroups.map((group) => <section className="simple-session-group" key={group.label}>
          <span>{group.label}</span>
          {group.items.map((thread) => <button className={thread.publicId === threadId ? "is-active" : ""}
            disabled={loadingThread} key={thread.publicId} onClick={() => void openThread(thread.publicId)} type="button">
            <strong>{thread.title}</strong><small>{formatThreadDate(thread.updatedAt)}</small>
          </button>)}
        </section>)}</nav>
      </aside>
      <div className="simple-chat-pane">
        <div className="simple-chat-toolbar"><strong>{currentThread?.title || "New chat"}</strong>
          {threadId ? <button className="simple-finish-review" disabled={reviewing || sending} onClick={() => void finishReview()} type="button">
            {reviewing ? <LoaderCircle className="simple-spin" size={15} /> : <Check size={15} />}Finish & review</button> : null}</div>
        <div className="simple-chat-messages" ref={messagesRef}>
          {messages.map((message) => <article className={`simple-message simple-message--${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "You" : "Tutor"}</span><MarkdownMessage content={message.content} /></article>)}
          {reviewBatch ? <ReviewBatchPanel batch={reviewBatch} onBatch={setReviewBatch} /> : null}
          {sending && <div className="simple-chat-loading"><LoaderCircle className="simple-spin" size={17} />Tutor is thinking…</div>}
        </div>
        <div className="simple-composer"><label className="simple-composer-upload" title="Upload a text file"><Upload size={17} /><input accept=".txt,text/plain" onChange={async (event) => {
          const file = event.target.files?.[0]; if (file) setDraft(await file.text()); event.target.value = "";
        }} type="file" /></label><textarea onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
          placeholder="Message your tutor…" rows={2} value={draft} />
          <button aria-label="Send" disabled={!draft.trim() || sending} onClick={() => void send()} type="button"><Send size={18} /></button></div>
      </div>
    </section>}
  </main>;
}
