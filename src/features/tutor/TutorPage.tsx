import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  LoaderCircle,
  Mic,
  MoveDiagonal2,
  PanelLeft,
  Plus,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { CaptureNotebook } from "../capture/CaptureNotebook";
import { AppLink } from "../../app/AppLink";
import type { ProfileId } from "../../../contracts/api";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import { apiFetch } from "../../shared/api";
import {
  maxRecordingBytes,
  maxRecordingSeconds,
  recordingFilename,
  supportedRecordingMimeType,
} from "../../shared/audioRecording";
import type { ChatMessage, ChatThread, Language } from "../../shared/contracts";
import { languageCopy, languageHasAudio } from "../../shared/config";
import type { HistoryMode, TutorRoute } from "../../lib/appRoute";
import { TutorChatMessage } from "./TutorChatMessage";
import { beginTutorSend, completeTutorSend, failTutorSend } from "./tutorOptimisticMessages";

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

type PendingTutorRecording = { blob: Blob; filename: string };

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const voiceErrorMessage = (error: unknown) => {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is blocked. Allow it in your browser or Home Screen app settings and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Voice recording failed.";
};

export function TutorPage({ language, route, onLibrary, onListen, onRoute, profileId }: {
  language: Language;
  route: TutorRoute;
  onRoute: (route: TutorRoute, historyMode?: HistoryMode) => void;
  profileId: ProfileId;
  onLibrary: () => void;
  onListen: () => void;
}) {
  const { mode, thread: threadId } = route;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(""); const [added, setAdded] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false); const [sessionsOpen, setSessionsOpen] = useState(false);
  const [deletingThread, setDeletingThread] = useState(false);
  const [reviewing, setReviewing] = useState(false); const [reviewBatch, setReviewBatch] = useState<ReviewBatch | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [recording, setRecording] = useState(false); const [transcribing, setTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0); const [voiceError, setVoiceError] = useState("");
  const [pendingVoice, setPendingVoice] = useState<PendingTutorRecording | null>(null);
  const [composerHeight, setComposerHeight] = useState(104);
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const scrollIntentRef = useRef<"instant" | "smooth" | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null); const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingIntervalRef = useRef<number | null>(null); const recordingTimeoutRef = useRef<number | null>(null);
  const voiceSessionRef = useRef(0); const voiceAbortRef = useRef<AbortController | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sessionsButtonRef = useRef<HTMLButtonElement>(null);
  const sessionsRailRef = useRef<HTMLElement>(null);
  const resizeStartRef = useRef<{ clientY: number; height: number } | null>(null);
  const storageKey = `rehearsal:${profileId}:tutor-thread:${language}`;
  const draftKey = `rehearsal:${profileId}:tutor-draft:${language}:${threadId || "new"}`;

  const refreshThreads = async () => {
    const response = await apiFetch(`/api/chat/threads?language=${language}&limit=50`);
    if (!response.ok) throw new Error("Could not load sessions");
    const data = await response.json() as { threads: ChatThread[] };
    setThreads(data.threads || []);
    return data.threads || [];
  };

  const stopVoiceTimers = () => {
    if (recordingIntervalRef.current !== null) window.clearInterval(recordingIntervalRef.current);
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    recordingIntervalRef.current = null; recordingTimeoutRef.current = null;
  };
  const releaseVoiceStream = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  useEffect(() => {
    const session = ++voiceSessionRef.current;
    setRecording(false); setTranscribing(false); setRecordingSeconds(0); setVoiceError(""); setPendingVoice(null);
    return () => {
      if (voiceSessionRef.current === session) voiceSessionRef.current += 1;
      voiceAbortRef.current?.abort(); voiceAbortRef.current = null;
      stopVoiceTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") { recorder.onstop = null; recorder.stop(); }
      recorderRef.current = null; releaseVoiceStream();
    };
  }, [language, profileId]);

  useEffect(() => {
    let cancelled = false;
    setReviewBatch(null); setMessages([]); setThreads([]); setSendError(""); setAdded(false);
    void (async () => {
      try {
        const response = await apiFetch(`/api/chat/threads?language=${language}&limit=50`);
        if (!response.ok) return;
        const data = await response.json() as { threads: ChatThread[] };
        if (cancelled) return;
        const nextThreads = data.threads || []; setThreads(nextThreads);
        const stored = window.localStorage.getItem(storageKey);
        const selected = nextThreads.find((thread) => thread.publicId === threadId)
          || nextThreads.find((thread) => thread.publicId === stored);
        if (selected && selected.publicId !== threadId) onRoute({ ...route, thread: selected.publicId }, "replace");
      } catch { /* A blank Tutor remains usable when history is unavailable. */ }
    })();
    return () => { cancelled = true; };
  }, [language, profileId]);

  useEffect(() => {
    let cancelled = false;
    setReviewBatch(null); setSendError(""); setAdded(false);
    if (!threadId) { setMessages([]); return; }
    setLoadingThread(true);
    void apiFetch(`/api/chat/${threadId}/messages`).then(async (response) => {
      if (!response.ok) throw new Error("Could not load session");
      const data = await response.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> };
      if (cancelled) return;
      scrollIntentRef.current = "instant";
      setMessages(data.messages.map((message) => ({ ...message, id: crypto.randomUUID() })));
      window.localStorage.setItem(storageKey, threadId);
    }).catch(() => {
      if (!cancelled) setSendError("This Tutor session could not be loaded. Start a new chat or choose another session.");
    }).finally(() => { if (!cancelled) setLoadingThread(false); });
    return () => { cancelled = true; };
  }, [language, threadId]);

  useEffect(() => setDraft(window.sessionStorage.getItem(draftKey) || ""), [draftKey]);
  useEffect(() => {
    if (draft) window.sessionStorage.setItem(draftKey, draft);
    else window.sessionStorage.removeItem(draftKey);
  }, [draft, draftKey]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!sessionsOpen || !isNarrow) return;
    window.requestAnimationFrame(() => sessionsRailRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeSessions();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNarrow, sessionsOpen]);

  const closeSessions = () => {
    setSessionsOpen(false);
    window.requestAnimationFrame(() => sessionsButtonRef.current?.focus());
  };

  useLayoutEffect(() => {
    const messageList = messagesRef.current;
    const intent = scrollIntentRef.current;
    if (!messageList || !intent) return;
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: intent === "smooth" ? "smooth" : "auto" });
    scrollIntentRef.current = null;
  }, [messages, reviewBatch]);

  const newChat = () => {
    window.sessionStorage.removeItem(`rehearsal:${profileId}:tutor-draft:${language}:new`);
    onRoute({ ...route, thread: null }); setMessages([]); setReviewBatch(null); setDraft(""); setSendError(""); setAdded(false); setSessionsOpen(false);
    window.localStorage.removeItem(storageKey);
  };

  const deleteChat = async () => {
    if (!threadId || deletingThread || !window.confirm("Delete this chat?")) return;
    setDeletingThread(true); setSendError("");
    try {
      const response = await apiFetch(`/api/chat/${threadId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Chat could not be deleted.");
      const remaining = threads.filter((thread) => thread.publicId !== threadId);
      setThreads(remaining); onRoute({ ...route, thread: remaining[0]?.publicId || null }, "replace"); setMessages([]); setReviewBatch(null); setAdded(false);
      window.localStorage.removeItem(storageKey);
    } catch { setSendError("Chat could not be deleted."); }
    finally { setDeletingThread(false); }
  };

  const prepareVocab = async (content: string, clientMessageId: string) => {
    const response = await apiFetch("/api/review-batches/vocab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, title: "Vocabulary from Tutor", text: content, threadId, clientMessageId }),
    });
    if (!response.ok) throw new Error("Vocab preparation failed");
    const data = await response.json() as { batch: ReviewBatch; threadId: string; content: string };
    return data;
  };

  const sendContent = async (rawContent: string, existingClientMessageId?: string) => {
    const content = rawContent.trim(); if (!content || sending) return false;
    const clientMessageId = existingClientMessageId || crypto.randomUUID();
    setSending(true); setSendError(""); setAdded(false);
    setDraft((current) => current.trim() === content ? "" : current);
    scrollIntentRef.current = "smooth";
    setMessages((current) => beginTutorSend(current, content, clientMessageId));
    try {
      if (looksLikeVocabList(content)) {
        const data = await prepareVocab(content, clientMessageId);
        setReviewBatch(data.batch); onRoute({ ...route, thread: data.threadId }, "replace"); window.localStorage.setItem(storageKey, data.threadId);
        setMessages((current) => completeTutorSend(current, clientMessageId, data.content));
      } else {
        const response = await apiFetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, message: content, threadId, clientMessageId }) });
        if (!response.ok) throw new Error("Chat unavailable");
        const data = await response.json() as { threadId: string; content: string }; onRoute({ ...route, thread: data.threadId }, "replace");
        window.localStorage.setItem(storageKey, data.threadId);
        setMessages((current) => completeTutorSend(current, clientMessageId, data.content));
      }
      void refreshThreads().catch(() => undefined);
      return true;
    } catch {
      setMessages((current) => failTutorSend(current, clientMessageId));
      return false;
    }
    finally { setSending(false); }
  };
  const send = () => sendContent(draft);

  const editFailedMessage = (message: ChatMessage) => {
    setMessages((current) => current.filter((currentMessage) => currentMessage.id !== message.id));
    setDraft(message.content);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const transcribeVoice = async (pending: PendingTutorRecording, session = voiceSessionRef.current) => {
    if (!pending.blob.size) { setVoiceError("The recording was empty. Try again closer to the microphone."); return; }
    if (pending.blob.size > maxRecordingBytes) { setVoiceError("The recording is larger than 25 MB. Record a shorter message."); return; }
    const controller = new AbortController(); voiceAbortRef.current = controller;
    setTranscribing(true); setVoiceError("");
    try {
      const form = new FormData(); form.append("audio", pending.blob, pending.filename);
      const response = await apiFetch(`/api/chat/transcribe?language=${language}`, {
        method: "POST", body: form, signal: controller.signal,
      });
      if (!response.ok) throw new Error("Transcription failed. Your recording is still available to retry.");
      const data = await response.json() as { transcript: string };
      if (session !== voiceSessionRef.current || controller.signal.aborted) return;
      setPendingVoice(null); setTranscribing(false);
      await sendContent(data.transcript);
    } catch (error) {
      if (session === voiceSessionRef.current && !controller.signal.aborted) setVoiceError(voiceErrorMessage(error));
    } finally {
      if (voiceAbortRef.current === controller) voiceAbortRef.current = null;
      if (session === voiceSessionRef.current) setTranscribing(false);
    }
  };

  const startVoiceRecording = async () => {
    if (recording || transcribing || pendingVoice || sending) return;
    const session = voiceSessionRef.current; setVoiceError(""); setRecordingSeconds(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Audio recording is not supported in this browser.");
      }
      const mimeType = supportedRecordingMimeType();
      if (!mimeType) throw new Error("This browser does not expose a supported recording format.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== voiceSessionRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const recorder = new MediaRecorder(stream, { mimeType }); const chunks: Blob[] = [];
      let intervalId: number | null = null; let timeoutId: number | null = null;
      const releaseRecorder = () => {
        if (intervalId !== null) window.clearInterval(intervalId);
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (recordingIntervalRef.current === intervalId) recordingIntervalRef.current = null;
        if (recordingTimeoutRef.current === timeoutId) recordingTimeoutRef.current = null;
        if (recorderRef.current === recorder) recorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        if (recordingStreamRef.current === stream) recordingStreamRef.current = null;
      };
      recorderRef.current = recorder; recordingStreamRef.current = stream;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        releaseRecorder();
        if (session === voiceSessionRef.current) { setRecording(false); setVoiceError("Recording failed. Nothing was sent."); }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType }); releaseRecorder();
        if (session !== voiceSessionRef.current) return;
        setRecording(false);
        if (!blob.size) { setVoiceError("The recording was empty. Try again closer to the microphone."); return; }
        if (blob.size > maxRecordingBytes) { setVoiceError("The recording is larger than 25 MB. Record a shorter message."); return; }
        const pending = { blob, filename: recordingFilename("tutor-message", blob.type) };
        setPendingVoice(pending); void transcribeVoice(pending, session);
      };
      recorder.start(); setRecording(true);
      intervalId = window.setInterval(() => setRecordingSeconds((value) => Math.min(maxRecordingSeconds, value + 1)), 1000);
      timeoutId = window.setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, maxRecordingSeconds * 1000);
      recordingIntervalRef.current = intervalId; recordingTimeoutRef.current = timeoutId;
    } catch (error) {
      if (session !== voiceSessionRef.current) return;
      stopVoiceTimers(); releaseVoiceStream(); setVoiceError(voiceErrorMessage(error));
    }
  };
  const stopVoiceRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const beginComposerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!composerRef.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = { clientY: event.clientY, height: composerRef.current.getBoundingClientRect().height };
  };
  const resizeComposer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = resizeStartRef.current;
    if (start) setComposerHeight(Math.max(104, Math.round(start.height + start.clientY - event.clientY)));
  };
  const finishComposerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const finishReview = async () => {
    if (!threadId || reviewing) return; setReviewing(true); setAdded(false);
    try {
      const response = await apiFetch(`/api/chat/${threadId}/review`, { method: "POST" });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { batch: ReviewBatch }; scrollIntentRef.current = "smooth"; setReviewBatch(data.batch);
    } catch { scrollIntentRef.current = "smooth"; setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "Review could not be prepared. Nothing was added to Library." }]); }
    finally { setReviewing(false); }
  };

  const today = new Date().toDateString();
  const currentThread = threads.find((thread) => thread.publicId === threadId);
  const threadGroups = [
    { label: "Today", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() === today) },
    { label: "Earlier", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() !== today) },
  ].filter((group) => group.items.length);

  return <main className={`simple-main ${mode === "chat" ? "simple-main--chat" : "simple-main--notebook"}`} id="main-content">
    <header className="simple-page-heading simple-tutor-heading"><h1>Tutor</h1>
      <div aria-label="Tutor mode" className="simple-tutor-mode" role="group">
        <AppLink aria-current={mode === "chat" ? "page" : undefined} className={mode === "chat" ? "is-active" : ""} route={{ ...route, mode: "chat" }}>Chat</AppLink>
        <AppLink aria-current={mode === "notebook" ? "page" : undefined} className={mode === "notebook" ? "is-active" : ""} route={{ ...route, mode: "notebook", thread: null }}>Notebook</AppLink>
      </div>
      {mode === "chat" ? <div className="simple-tutor-mobile-actions">
        <button onClick={() => setSessionsOpen(true)} ref={sessionsButtonRef} type="button"><PanelLeft size={16} />Sessions</button>
        <button aria-label="New chat" onClick={newChat} title="New chat" type="button"><Plus size={17} /></button>
      </div> : null}</header>
    {mode === "notebook" ? <CaptureNotebook language={language} profileId={profileId} onLibrary={onLibrary} onListen={onListen} /> : <section className="simple-chat"
      style={{ "--tutor-composer-height": `${composerHeight}px` } as CSSProperties}>
      {sessionsOpen ? <button aria-label="Close sessions" className="simple-session-backdrop" onClick={closeSessions} type="button" /> : null}
      <aside aria-hidden={isNarrow && !sessionsOpen ? "true" : undefined} className={`simple-session-rail ${sessionsOpen ? "is-open" : ""}`}
        inert={isNarrow && !sessionsOpen} ref={sessionsRailRef}>
        <div className="simple-session-rail-heading"><strong>Sessions</strong>
          <button aria-label="Close sessions" onClick={closeSessions} type="button"><X size={16} /></button></div>
        <button className="simple-new-chat" onClick={newChat} type="button"><Plus size={16} />New chat</button>
        <nav aria-label="Tutor sessions">{threadGroups.map((group) => <section className="simple-session-group" key={group.label}>
          <span>{group.label}</span>
          {group.items.map((thread) => <AppLink aria-current={thread.publicId === threadId ? "page" : undefined} className={thread.publicId === threadId ? "is-active" : ""}
            key={thread.publicId} onClick={closeSessions} route={{ ...route, thread: thread.publicId }}>
            <strong>{thread.title}</strong><small>{formatThreadDate(thread.updatedAt)}</small>
          </AppLink>)}
        </section>)}</nav>
      </aside>
      <div className="simple-chat-pane">
        <div className="simple-chat-toolbar"><strong>{currentThread?.title || "New chat"}</strong>
          {threadId ? <div><button aria-label="Delete chat" className="simple-delete-chat" disabled={deletingThread || sending || reviewing}
              onClick={() => void deleteChat()} title="Delete chat" type="button">{deletingThread ? <LoaderCircle className="simple-spin" size={15} /> : <Trash2 size={15} />}</button></div> : null}</div>
        <div aria-busy={sending || loadingThread} aria-live="polite" className="simple-chat-messages" ref={messagesRef} role="log">
          {!messages.length && !loadingThread && !sending ? <div className="simple-chat-empty"><strong>Start with something from real life</strong>
            <span>Ask Tutor to use your Library, correct a message, or make a short speaking drill.</span><div>
              {["Find useful phrases from my Library", "Correct a message I wrote", "Give me a short speaking drill"].map((prompt) => <button key={prompt}
                onClick={() => { setDraft(prompt); window.requestAnimationFrame(() => composerRef.current?.focus()); }} type="button">{prompt}</button>)}</div></div> : null}
          {messages.map((message, messageIndex) => <TutorChatMessage key={message.id} learnerMessage={message.role === "assistant" ? messages.slice(0, messageIndex).reverse().find((candidate) => candidate.role === "user")?.content : undefined}
            message={message}
            onDelete={(failed) => setMessages((current) => current.filter((currentMessage) => currentMessage.id !== failed.id))}
            onEdit={editFailedMessage}
            onRetry={(failed) => void sendContent(failed.content, failed.clientMessageId)} tutorLabel={languageCopy[language].label} />)}
          {reviewBatch ? <ReviewBatchPanel batch={reviewBatch} onBatch={setReviewBatch} onCommitted={() => { setReviewBatch(null); setAdded(true); }} /> : null}
          {added ? <div className="simple-tutor-added"><strong>Added to Library</strong><div>
            {languageHasAudio(language) ? <button onClick={onListen} type="button">Listen now</button> : null}
            <button onClick={onLibrary} type="button">View in Library</button></div></div> : null}
        </div>
        {sendError ? <div className="simple-composer-error" role="alert"><span>{sendError}</span><button onClick={() => setSendError("")} type="button">Dismiss</button></div> : null}
        {recording || transcribing || voiceError || pendingVoice ? <div aria-live="polite" className={`simple-composer-voice-status${voiceError ? " is-error" : ""}`}>
          <span>{recording ? `Listening · ${formatDuration(recordingSeconds)} · tap Stop to send`
            : transcribing ? "Transcribing your message…" : voiceError}</span>
          {pendingVoice && !transcribing ? <div><button onClick={() => void transcribeVoice(pendingVoice)} type="button"><RefreshCw size={14} />Retry</button>
            <button onClick={() => { setPendingVoice(null); setVoiceError(""); }} type="button"><Trash2 size={14} />Delete recording</button></div> : null}
        </div> : null}
        <div className="simple-composer">
          <div className="simple-composer-input"><label className="simple-visually-hidden" htmlFor="tutor-message">Message your tutor</label><textarea autoComplete="off" id="tutor-message" name="tutor-message" onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
            placeholder="Message your tutor…" ref={composerRef} rows={2} style={{ height: `${composerHeight}px` }} value={draft} />
            <button aria-label="Resize message field" className="simple-composer-resize" onKeyDown={(event) => {
              if (event.key === "ArrowUp") { event.preventDefault(); setComposerHeight((height) => height + 40); }
              if (event.key === "ArrowDown") { event.preventDefault(); setComposerHeight((height) => Math.max(104, height - 40)); }
            }} onPointerCancel={finishComposerResize} onPointerDown={beginComposerResize} onPointerMove={resizeComposer}
              onPointerUp={finishComposerResize} title="Drag up to enlarge" type="button"><MoveDiagonal2 size={14} /></button></div>
          <div className="simple-composer-controls"><div className="simple-composer-tools">
            <label aria-disabled={sending || recording || transcribing} className="simple-composer-upload" title="Upload a text file"><Upload size={17} /><input accept=".txt,text/plain" aria-label="Upload a text file" name="tutor-file"
              disabled={sending || recording || transcribing} onChange={async (event) => {
              const file = event.target.files?.[0]; if (file) setDraft(await file.text()); event.target.value = "";
            }} type="file" /></label>
            <button aria-label={recording ? "Stop and send voice message" : "Record and send voice message"}
              className={`simple-composer-record${recording ? " is-recording" : ""}`}
              disabled={sending || transcribing || Boolean(pendingVoice)} onClick={recording ? stopVoiceRecording : () => void startVoiceRecording()}
              title={recording ? "Stop and send" : "Voice message"} type="button">
              {recording ? <Square fill="currentColor" size={15} /> : transcribing ? <LoaderCircle className="simple-spin" size={17} /> : <Mic size={18} />}
            </button>
            {threadId ? <button className="simple-finish-review" disabled={reviewing || sending} onClick={() => void finishReview()} type="button">
              {reviewing ? <LoaderCircle className="simple-spin" size={15} /> : <WandSparkles size={15} />}Finish &amp; make cards</button> : null}
          </div><div className="simple-composer-send-group"><span>Enter to send</span>
            <button aria-label="Send" className="simple-composer-send" disabled={!draft.trim() || sending || recording || transcribing}
              onClick={() => void send()} title="Send" type="button"><Send size={18} /></button></div></div>
        </div>
      </div>
    </section>}
  </main>;
}
