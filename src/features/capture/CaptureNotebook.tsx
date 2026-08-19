import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, Plus, RefreshCw, Save, Square, Trash2, WandSparkles } from "lucide-react";
import type { ProfileId } from "../../../contracts/api";
import { apiFetch } from "../../shared/api";
import type { Language } from "../../shared/contracts";
import { ReviewBatchPanel, type ReviewBatch } from "../review/ReviewBatchPanel";
import {
  deletePendingRecording,
  loadPendingRecording,
  type PendingRecording,
  savePendingRecording,
} from "./pendingRecordings";

type CaptureStatus = "transcribing" | "ready" | "batched" | "processed" | "failed";
type CaptureNote = {
  publicId: string;
  language: Language;
  transcript: string;
  audioMime: string | null;
  status: CaptureStatus;
  error: string | null;
  reviewBatchId: string | null;
  createdAt: string;
  updatedAt: string;
};

const maxBytes = 25 * 1024 * 1024;
const maxDurationSeconds = 5 * 60;
const preferredMimeTypes = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const friendlyError = (error: unknown) => {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is blocked. Allow it in your browser or Home Screen app settings and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Nothing was added to Library.";
};

export function CaptureNotebook({ language, profileId, onLibrary, onListen }: {
  language: Language;
  profileId: ProfileId;
  onLibrary: () => void;
  onListen: () => void;
}) {
  const [notes, setNotes] = useState<CaptureNote[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [textDraft, setTextDraft] = useState("");
  const [addingText, setAddingText] = useState(false);
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [added, setAdded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [pendingRecording, setPendingRecording] = useState<PendingRecording | null>(null);
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const sessionRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const stopTimers = () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null; timeoutRef.current = null;
  };
  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const refresh = async (session = sessionRef.current) => {
    const response = await apiFetch(`/api/captures?language=${language}`);
    if (!response.ok) throw new Error("Could not load voice notes.");
    const data = await response.json() as { notes: CaptureNote[]; activeBatch: ReviewBatch | null };
    if (session !== sessionRef.current) return;
    setNotes(data.notes || []); setBatch(data.activeBatch || null);
    setDrafts((current) => Object.fromEntries((data.notes || []).map((note) => [note.publicId, current[note.publicId] ?? note.transcript])));
  };

  useEffect(() => {
    const session = ++sessionRef.current;
    let cancelled = false;
    setNotes([]); setDrafts({}); setBatch(null); setPendingRecording(null);
    setNotice(""); setRemaining(0); setAdded(false); setRecording(false); setUploading(false);
    void Promise.allSettled([refresh(session), loadPendingRecording(profileId, language)]).then((results) => {
      if (cancelled) return;
      const [remote, local] = results;
      if (local.status === "fulfilled" && local.value) {
        setPendingRecording(local.value);
        setNotice("Recovered an unsent recording from this device.");
      } else if (remote.status === "rejected") {
        setNotice(friendlyError(remote.reason));
      }
    });
    return () => {
      cancelled = true;
      if (sessionRef.current === session) sessionRef.current += 1;
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = null;
      stopTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null; releaseStream();
    };
  }, [language, profileId]);

  const upload = async (recording: PendingRecording, session = sessionRef.current) => {
    if (!recording.blob.size) { setNotice("The recording was empty. Try again closer to the microphone."); return; }
    if (recording.blob.size > maxBytes) { setNotice("The recording is larger than 25 MB. Record a shorter note."); return; }
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      if (session !== sessionRef.current) return;
      setUploading(true); setNotice("Uploading and transcribing your Russian note…");
      const form = new FormData(); form.append("audio", recording.blob, recording.filename);
      const response = await apiFetch(`/api/captures?language=${language}`, {
        method: "POST",
        body: form,
        headers: { "X-Rehearsal-Capture-Id": recording.uploadId },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error === "UNSUPPORTED_AUDIO_TYPE" ? "The browser produced an unsupported audio format." : "The recording could not be uploaded.");
      }
      const data = await response.json() as { note: CaptureNote; transcriptionFailed?: boolean };
      await deletePendingRecording(profileId, language);
      if (session !== sessionRef.current) return;
      setPendingRecording(null);
      setNotice(data.transcriptionFailed || data.note.status === "failed"
        ? "Transcription failed. The audio is safe for Retry or Delete."
        : data.note.status === "transcribing"
          ? "Recording received. Transcription is still finishing."
          : "Transcription ready. You can edit it below.");
      await refresh(session);
    } catch (error) {
      if (session === sessionRef.current && !controller.signal.aborted) setNotice(friendlyError(error));
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      if (session === sessionRef.current) setUploading(false);
    }
  };

  const startRecording = async () => {
    if (recording || uploading || pendingRecording) return;
    const session = sessionRef.current;
    setNotice(""); setElapsed(0);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Audio recording is not supported in this browser.");
      }
      const mimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("This browser does not expose a supported recording format.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      let intervalId: number | null = null;
      let timeoutId: number | null = null;
      const releaseRecorder = () => {
        if (intervalId !== null) window.clearInterval(intervalId);
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (intervalRef.current === intervalId) intervalRef.current = null;
        if (timeoutRef.current === timeoutId) timeoutRef.current = null;
        if (recorderRef.current === recorder) recorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
      };
      recorderRef.current = recorder; streamRef.current = stream;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        releaseRecorder();
        if (session === sessionRef.current) {
          setNotice("Recording failed. Nothing was uploaded.");
          setRecording(false);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        releaseRecorder();
        if (session === sessionRef.current) setRecording(false);
        if (!blob.size) {
          if (session === sessionRef.current) setNotice("The recording was empty. Try again closer to the microphone.");
          return;
        }
        if (blob.size > maxBytes) {
          if (session === sessionRef.current) setNotice("The recording is larger than 25 MB. Record a shorter note.");
          return;
        }
        const extension = blob.type.includes("mp4") ? "m4a" : "webm";
        if (session === sessionRef.current) setUploading(true);
        void savePendingRecording(profileId, language, blob, `capture.${extension}`).then((saved) => {
          if (session !== sessionRef.current) return;
          setPendingRecording(saved);
          return upload(saved, session);
        }).catch((error) => {
          if (session === sessionRef.current) {
            setUploading(false);
            setNotice(friendlyError(error));
          }
        });
      };
      recorder.start(); setRecording(true);
      intervalId = window.setInterval(() => setElapsed((value) => Math.min(maxDurationSeconds, value + 1)), 1000);
      timeoutId = window.setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, maxDurationSeconds * 1000);
      intervalRef.current = intervalId;
      timeoutRef.current = timeoutId;
    } catch (error) {
      if (session !== sessionRef.current) return;
      stopTimers(); releaseStream(); setNotice(friendlyError(error));
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  const addText = async () => {
    const transcript = textDraft.trim();
    if (!transcript || addingText) return;
    setAddingText(true); setNotice(""); setAdded(false);
    try {
      const response = await apiFetch("/api/captures/text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, transcript }),
      });
      if (!response.ok) throw new Error("The note could not be added.");
      setTextDraft(""); await refresh(); setNotice("Note added.");
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setAddingText(false); }
  };
  const saveNote = async (note: CaptureNote) => {
    const transcript = (drafts[note.publicId] || "").trim();
    if (!transcript || transcript === note.transcript) return;
    setNotice("");
    try {
      const response = await apiFetch(`/api/captures/${note.publicId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }),
      });
      if (!response.ok) throw new Error("The note could not be saved.");
      await refresh(); setNotice("Note saved.");
    } catch (error) { setNotice(friendlyError(error)); }
  };
  const removeNote = async (note: CaptureNote) => {
    setNotice("");
    const response = await apiFetch(`/api/captures/${note.publicId}`, { method: "DELETE" });
    if (!response.ok) { setNotice("This note is already in the current review package."); return; }
    await refresh();
  };
  const retry = async (note: CaptureNote) => {
    setNotice("Retrying transcription with OpenAI…");
    const response = await apiFetch(`/api/captures/${note.publicId}/retry`, { method: "POST" });
    if (!response.ok) { setNotice("This recording is no longer available for Retry."); return; }
    const data = await response.json() as { transcriptionFailed?: boolean };
    await refresh(); setNotice(data.transcriptionFailed ? "Transcription failed again. You can Retry or Delete." : "Transcription ready.");
  };
  const prepare = async () => {
    if (processing) return;
    setProcessing(true); setNotice("Preparing a natural card package…"); setRemaining(0);
    try {
      const response = await apiFetch("/api/captures/process", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }),
      });
      if (!response.ok) throw new Error("No ready notes to prepare, or OpenAI is unavailable.");
      const data = await response.json() as { batch: ReviewBatch; remaining: number };
      setBatch(data.batch); setRemaining(data.remaining || 0); await refresh();
      setNotice(data.remaining ? `${data.remaining} newer notes remain for the next package.` : "Nothing has been saved yet. Review the package below.");
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setProcessing(false); }
  };

  const readyCount = notes.filter((note) => note.status === "ready").length;
  return <section className="capture-notebook">
    <div className="capture-entry">
      <textarea aria-label="Russian note" maxLength={30_000} onChange={(event) => setTextDraft(event.target.value)}
        placeholder="Write a Russian thought…" rows={3} value={textDraft} />
      <div><button className="simple-primary" disabled={!textDraft.trim() || addingText} onClick={() => void addText()} type="button">
        {addingText ? <LoaderCircle className="simple-spin" size={16} /> : <Plus size={16} />}Add note</button>
        <button aria-label={recording ? "Stop recording" : "Start recording"} className={`capture-record${recording ? " is-recording" : ""}`}
          disabled={uploading || Boolean(pendingRecording)} onClick={recording ? stopRecording : () => void startRecording()} type="button">
          {recording ? <Square fill="currentColor" size={16} /> : uploading ? <LoaderCircle className="simple-spin" size={17} /> : <Mic size={17} />}
          <span>{recording ? formatDuration(elapsed) : uploading ? "Transcribing" : "Record"}</span>
        </button></div>
    </div>
    {notice ? <div aria-live="polite" className="capture-notice">{notice}</div> : null}
    {pendingRecording && !uploading ? <div className="capture-pending-audio"><span>This recording is saved on this device until the server accepts it.</span>
      <div><button onClick={() => void upload(pendingRecording)} type="button"><RefreshCw size={14} />Retry upload</button>
        <button onClick={() => void deletePendingRecording(profileId, language).then(() => {
          setPendingRecording(null); setNotice("Unsent recording deleted from this device.");
        }).catch((error) => setNotice(friendlyError(error)))} type="button"><Trash2 size={14} />Delete recording</button></div></div> : null}

    <div className="capture-list-heading"><div><h3>Notebook</h3><span>{notes.length} {notes.length === 1 ? "note" : "notes"}</span></div>
      <button className="simple-primary" disabled={!readyCount || processing || Boolean(batch)} onClick={() => void prepare()} type="button">
        {processing ? <LoaderCircle className="simple-spin" size={15} /> : <WandSparkles size={15} />}Prepare cards{readyCount ? ` (${readyCount})` : ""}
      </button></div>
    {!notes.length ? <p className="capture-empty">No notes</p> : <div className="capture-notes">
      {notes.map((note) => <article className="capture-note" key={note.publicId}>
        <header><span className={`is-${note.status}`}>{note.status}</span><time>{new Date(note.createdAt).toLocaleString()}</time></header>
        {note.status === "failed" ? <p className="capture-error">OpenAI could not transcribe this recording. The audio is temporarily retained.</p> :
          <textarea aria-label="Russian transcript" disabled={note.status === "batched"} onChange={(event) => setDrafts((current) => ({ ...current, [note.publicId]: event.target.value }))}
            rows={3} value={drafts[note.publicId] ?? note.transcript} />}
        <footer>
          {note.status === "failed" ? <button onClick={() => void retry(note)} type="button"><RefreshCw size={14} />Retry</button> :
            <button disabled={note.status !== "ready" || !drafts[note.publicId]?.trim() || drafts[note.publicId] === note.transcript}
              onClick={() => void saveNote(note)} type="button"><Save size={14} />Save edit</button>}
          <button disabled={note.status === "batched"} onClick={() => void removeNote(note)} type="button"><Trash2 size={14} />Delete</button>
        </footer>
      </article>)}
    </div>}
    {remaining ? <p className="capture-remaining">{remaining} notes will stay ready for the next package.</p> : null}
    {batch ? <ReviewBatchPanel batch={batch} onBatch={setBatch} onCommitted={() => {
      setBatch(null); setRemaining(0); setNotice(""); setAdded(true); void refresh();
    }} /> : null}
    {added ? <div className="capture-added"><strong>Added to Library</strong><div>
      {language === "en" ? <button onClick={onListen} type="button">Listen now</button> : null}
      <button onClick={onLibrary} type="button">View in Library</button></div></div> : null}
  </section>;
}
