import { useState } from "react";
import { ArrowUp, BookmarkPlus, Layers3, MessageCircleMore, Sparkles, WandSparkles } from "lucide-react";
import type { LanguageCode } from "../types/practice";

type Message = {
  id: number;
  role: "student" | "tutor";
  text: string;
};

const initialMessages: Message[] = [
  {
    id: 1,
    role: "student",
    text: "I have zero need in a car in Riga. Everything within easy reach.",
  },
  {
    id: 2,
    role: "tutor",
    text: "A more natural version would be: “I don't really need a car in Riga. Everything is within easy reach.” The main issue is the collocation: we say have no need for something, not need in something.",
  },
];

export function TutorView({ language }: { language: LanguageCode }) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");

  const send = () => {
    if (!draft.trim()) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "student", text: draft.trim() },
      {
        id: Date.now() + 1,
        role: "tutor",
        text: "Интерфейс разговора уже готов. В следующем срезе этот ответ будет приходить от LLM с доступом к твоим фразам, ошибкам и прогрессу.",
      },
    ]);
    setDraft("");
  };

  return (
    <section className="tutor-view">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Tutor · {language === "en" ? "English" : "Latviešu"}</span>
          <h1>Разговор, который остаётся в системе</h1>
          <p>Исправления и удачные формулировки превращаются в материал без копирования между приложениями.</p>
        </div>
        <span className="phase-badge">LLM · следующий срез</span>
      </header>

      <div className="chat-shell">
        <div className="chat-context">
          <MessageCircleMore size={17} />
          <span>Фокус: casual, native-like, твои реальные разговоры</span>
        </div>

        <div className="message-list">
          {messages.map((message) => (
            <article className={`message message--${message.role}`} key={message.id}>
              <span className="message-role">{message.role === "student" ? "Ты" : "Tutor"}</span>
              <p>{message.text}</p>
              {message.role === "tutor" && message.id === 2 ? (
                <div className="message-actions">
                  <button type="button"><BookmarkPlus size={15} />Сохранить фразу</button>
                  <button type="button"><Layers3 size={15} />Создать остров</button>
                  <button type="button"><WandSparkles size={15} />Другой контекст</button>
                </div>
              ) : null}
            </article>
          ))}
        </div>

        <div className="composer">
          <Sparkles size={18} />
          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Расскажи что-нибудь или попроси потренировать тему…"
            rows={1}
            value={draft}
          />
          <button aria-label="Отправить" disabled={!draft.trim()} onClick={send} type="button">
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
