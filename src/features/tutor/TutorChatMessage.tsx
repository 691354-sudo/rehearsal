import { LoaderCircle, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { ChatMessage } from "../../shared/contracts";
import { splitTutorCorrection, TutorMarkdownMessage } from "./TutorMarkdownMessage";

export function TutorChatMessage({ learnerMessage, message, onDelete, onEdit, onRetry, tutorLabel }: {
  learnerMessage?: string;
  message: ChatMessage;
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  tutorLabel: string;
}) {
  const correction = message.role === "assistant" ? splitTutorCorrection(message.content, learnerMessage) : null;
  return <article className={`simple-message simple-message--${message.role}`} data-status={message.status}>
    {message.role === "assistant" && (!correction || correction.reply) ? <span>{tutorLabel}</span> : null}
    {message.status === "placeholder" ? <div className="simple-chat-loading" role="status">
      <LoaderCircle className="simple-spin" size={17} />Tutor is thinking…
    </div> : <TutorMarkdownMessage content={message.content} learnerMessage={learnerMessage} />}
    {message.role === "user" && message.status === "sending" ? <small className="simple-message-status">Sending…</small> : null}
    {message.role === "user" && message.status === "failed" ? <div className="simple-message-failed">
      <small>Not sent</small><div>
        <button onClick={() => onRetry(message)} type="button"><RefreshCw size={14} />Retry</button>
        <button onClick={() => onEdit(message)} type="button"><Pencil size={14} />Edit</button>
        <button onClick={() => onDelete(message)} type="button"><Trash2 size={14} />Delete</button>
      </div>
    </div> : null}
  </article>;
}
