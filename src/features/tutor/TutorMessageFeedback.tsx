import { MessageSquareText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tutorFeedbackMaxLength, type TutorFeedback } from "../../../contracts/tutor-feedback";
import { apiFetch } from "../../shared/api";

export function TutorMessageFeedback({ profileId, threadId, messageId, feedback, open, onToggle, onSaved }: {
  profileId: string; threadId: string; messageId: number; feedback: TutorFeedback | null;
  open: boolean; onToggle: () => void; onSaved: (feedback: TutorFeedback | null) => void;
}) {
  const key = `rehearsal:${profileId}:tutor-feedback:${threadId}:${messageId}`;
  const [draft, setDraft] = useState(() => window.sessionStorage.getItem(key) ?? feedback?.text ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const active = useRef(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (open) field.current?.focus({ preventScroll: true });
  }, [open]);

  const save = async () => {
    const text = draft.trim();
    if (saving || text === (feedback?.text ?? "")) return;
    setSaving(true); setError(""); setStatus("Saving feedback");
    try {
      const response = await apiFetch(`/api/chat/${threadId}/messages/${messageId}/feedback`, {
        method: text ? "PUT" : "DELETE",
        ...(text ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) } : {}),
      });
      if (!response.ok) throw new Error("Feedback save failed");
      const saved = text ? (await response.json() as { feedback: TutorFeedback }).feedback : null;
      if (window.sessionStorage.getItem(key) === draft) window.sessionStorage.removeItem(key);
      if (active.current) { setDraft(saved?.text ?? ""); setStatus(saved ? "Feedback saved" : "Feedback removed"); toggle.current?.focus({ preventScroll: true }); onSaved(saved); }
    } catch {
      if (active.current) { setStatus(""); setError("Could not save. Your text is still here. Try again."); }
    } finally { if (active.current) setSaving(false); }
  };

  return <div className="tutor-message-feedback">
    <button ref={toggle} className="tutor-feedback-toggle" type="button" aria-label={feedback ? "Edit feedback" : "Give feedback"}
      aria-expanded={open} aria-controls={`tutor-feedback-${messageId}`} data-saved={Boolean(feedback)} onClick={onToggle}>
      <MessageSquareText size={15} aria-hidden="true" />
    </button>
    <span className="tutor-feedback-status" role="status">{status}</span>
    {open ? <div className="tutor-feedback-editor" id={`tutor-feedback-${messageId}`}>
      <textarea ref={field} name="feedback" autoComplete="off" aria-label="Feedback on Tutor response"
        aria-describedby={error ? `tutor-feedback-error-${messageId}` : undefined} maxLength={tutorFeedbackMaxLength} value={draft}
        disabled={saving} onChange={(event) => {
          const value = event.target.value; window.sessionStorage.setItem(key, value); setDraft(value); setError("");
        }} />
      {error ? <p id={`tutor-feedback-error-${messageId}`} className="tutor-feedback-error" role="alert">{error}</p> : null}
      <div className="tutor-feedback-actions"><button type="button" disabled={saving || draft.trim() === (feedback?.text ?? "")}
        aria-busy={saving} onClick={() => void save()}>Save</button></div>
    </div> : null}
  </div>;
}
