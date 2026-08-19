import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, RefreshCw, Save, Square, Trash2, WandSparkles } from "lucide-react";
import { apiPath } from "../lib/api";
import { ReviewBatchPanel, type ReviewBatch } from "./ReviewBatchPanel";

type Language = "en" | "lv";
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
    return "Microphone access is blocked. Allow it in Brave settings and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Nothing was added to Practice.";
};

export function CaptureNotebook({ language }: { language: Language }) {
  const [notes, setNotes] = useState<CaptureNote[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<ReviewBatch | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [pendingAudio, setPendingAudio] = useState<Blob | null>(null);
  const [notice, setNotice] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const stopTimers = () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null; timeoutRef.current = null;
  };
  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const refresh = async () => {
    const response = await fetch(apiPath(`/api/captures?language=${language}`));
    if (!response.ok) throw new Error("Could not load voice notes.");
    const data = await response.json() as { notes: CaptureNote[]; activeBatch: ReviewBatch | null };
    setNotes(data.notes || []); setBatch(data.activeBatch || null);
    setDrafts((current) => Object.fromEntries((data.notes || []).map((note) => [note.publicId, current[note.publicId] ?? note.transcript])));
  };

  useEffect(() => {
    setNotes([]); setDrafts({}); setBatch(null); setNotice(""); setRemaining(0);
    void refresh().catch((error) => setNotice(friendlyError(error)));
    return () => {
      stopTimers();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      recorderRef.current = null; releaseStream();
    };
  }, [language]);

  const upload = async (blob: Blob) => {
    if (!blob.size) { setNotice("The recording was empty. Try again closer to the microphone."); return; }
    if (blob.size > maxBytes) { setNotice("The recording is larger than 25 MB. Record a shorter note."); return; }
    setPendingAudio(blob);
    setUploading(true); setNotice("Transcribing your Russian note with OpenAI…");
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const form = new FormData(); form.append("audio", blob, `capture.${extension}`);
      const response = await fetch(apiPath(`/api/captures?language=${language}`), { method: "POST", body: form });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error === "UNSUPPORTED_AUDIO_TYPE" ? "Brave produced an unsupported audio format." : "The recording could not be uploaded.");
      }
      const data = await response.json() as { note: CaptureNote; transcriptionFailed?: boolean };
      setPendingAudio(null);
      setNotice(data.transcriptionFailed ? "Transcription failed. The audio is safe for Retry or Delete." : "Transcription ready. You can edit it below.");
      await refresh();
    } catch (error) { setNotice(friendlyError(error)); }
    finally { setUploading(false); }
  };

  const startRecording = async () => {
    if (recording || uploading) return;
    setNotice(""); setElapsed(0); chunksRef.current = [];
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Audio recording is not supported in this version of Brave.");
      }
      const mimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Brave does not expose a supported recording format on this iPhone.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder; streamRef.current = stream;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onerror = () => { setNotice("Recording failed. Nothing was uploaded."); setRecording(false); stopTimers(); releaseStream(); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        recorderRef.current = null; setRecording(false); stopTimers(); releaseStream();
        void upload(blob);
      };
      recorder.start(); setRecording(true);
      intervalRef.current = window.setInterval(() => setElapsed((value) => Math.min(maxDurationSeconds, value + 1)), 1000);
      timeoutRef.current = window.setTimeout(() => { if (recorder.state !== "inactive") recorder.stop(); }, maxDurationSeconds * 1000);
    } catch (error) { stopTimers(); releaseStream(); setNotice(friendlyError(error)); }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  const saveNote = async (note: CaptureNote) => {
    const transcript = (drafts[note.publicId] || "").trim();
    if (!transcript || transcript === note.transcript) return;
    setNotice("");
    try {
      const response = await fetch(apiPath(`/api/captures/${note.publicId}`), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript }),
      });
      if (!response.ok) throw new Error("The note could not be saved.");
      await refresh(); setNotice("Note saved.");
    } catch (error) { setNotice(friendlyError(error)); }
  };
  const removeNote = async (note: CaptureNote) => {
    setNotice("");
    const response = await fetch(apiPath(`/api/captures/${note.publicId}`), { method: "DELETE" });
    if (!response.ok) { setNotice("This note is already in the current review package."); return; }
    await refresh();
  };
  const retry = async (note: CaptureNote) => {
    setNotice("Retrying transcription with OpenAI…");
    const response = await fetch(apiPath(`/api/captures/${note.publicId}/retry`), { method: "POST" });
    if (!response.ok) { setNotice("This recording is no longer available for Retry."); return; }
    const data = await response.json() as { transcriptionFailed?: boolean };
    await refresh(); setNotice(data.transcriptionFailed ? "Transcription failed again. You can Retry or Delete." : "Transcription ready.");
  };
  const prepare = async () => {
    if (processing) return;
    setProcessing(true); setNotice("Preparing a natural card package…"); setRemaining(0);
    try {
      const response = await fetch(apiPath("/api/captures/process"), {
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
    <div className="capture-intro">
      <div><h2>Capture what you really say</h2><p>Speak freely in Russian. Notes stay here until you ask AI to turn them into natural {language === "en" ? "English" : "Latvian"} cards.</p></div>
      <button aria-label={recording ? "Stop recording" : "Start recording"} className={`capture-record${recording ? " is-recording" : ""}`}
        disabled={uploading} onClick={recording ? stopRecording : () => void startRecording()} type="button">
        {recording ? <Square fill="currentColor" size={20} /> : uploading ? <LoaderCircle className="simple-spin" size={23} /> : <Mic size={23} />}
        <span>{recording ? formatDuration(elapsed) : uploading ? "Transcribing" : "Record"}</span>
      </button>
    </div>
    <div aria-live="polite" className="capture-notice">{notice || "Up to 5 minutes per note. Original audio is deleted after a successful transcription."}</div>
    {pendingAudio && !uploading ? <div className="capture-pending-audio"><span>The recording is still on this screen and has not been uploaded.</span>
      <div><button onClick={() => void upload(pendingAudio)} type="button"><RefreshCw size={14} />Retry upload</button>
        <button onClick={() => { setPendingAudio(null); setNotice("Unsent recording deleted."); }} type="button"><Trash2 size={14} />Delete recording</button></div></div> : null}

    <div className="capture-list-heading"><div><h3>Notebook</h3><span>{notes.length} {notes.length === 1 ? "note" : "notes"}</span></div>
      <button className="simple-primary" disabled={!readyCount || processing || Boolean(batch)} onClick={() => void prepare()} type="button">
        {processing ? <LoaderCircle className="simple-spin" size={15} /> : <WandSparkles size={15} />}Prepare cards{readyCount ? ` (${readyCount})` : ""}
      </button></div>
    {!notes.length ? <div className="capture-empty"><Mic size={20} /><strong>Your voice notebook is empty</strong><span>Record thoughts, errands, stories, frustrations—anything you would actually want to say.</span></div> : <div className="capture-notes">
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
      setBatch(null); setRemaining(0); setNotice("Cards added to Practice. The source notes are now processed."); void refresh();
    }} /> : null}
  </section>;
}
