import { useMemo, useState } from "react";
import { BookOpenText, FilePlus2, Search, Sparkles, Volume2 } from "lucide-react";
import type { LanguageCode, PracticeItem } from "../types/practice";

type ImportedSource = {
  id: number;
  title: string;
  text: string;
  sentenceCount: number;
};

export function LibraryView({
  language,
  items,
}: {
  language: LanguageCode;
  items: PracticeItem[];
}) {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sources, setSources] = useState<ImportedSource[]>([]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter(
      (item) =>
        item.target.toLocaleLowerCase().includes(normalized) ||
        item.cue.toLocaleLowerCase().includes(normalized),
    );
  }, [items, query]);

  const importText = () => {
    if (!text.trim()) return;
    const sentenceCount = Math.max(
      text
        .trim()
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean).length,
      1,
    );
    setSources((current) => [
      {
        id: Date.now(),
        title: title.trim() || `Новый текст ${current.length + 1}`,
        text: text.trim(),
        sentenceCount,
      },
      ...current,
    ]);
    setTitle("");
    setText("");
  };

  return (
    <section className="library-view">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Library · {language === "en" ? "English" : "Latviešu"}</span>
          <h1>Материал для твоей речи</h1>
          <p>Фразы, ошибки и тексты живут здесь, но всегда ведут обратно в практику.</p>
        </div>
      </header>

      <div className="library-grid">
        <section className="import-card">
          <div className="section-title">
            <span className="section-glyph"><FilePlus2 size={19} /></span>
            <div>
              <h2>Добавить текст для shadowing</h2>
              <p>Исходник сохранится без изменений.</p>
            </div>
          </div>
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название или источник"
            type="text"
            value={title}
          />
          <textarea
            onChange={(event) => setText(event.target.value)}
            placeholder="Вставь текст, транскрипт или историю…"
            rows={7}
            value={text}
          />
          <button className="primary-button" disabled={!text.trim()} onClick={importText} type="button">
            <Sparkles size={17} />
            Подготовить материал
          </button>
          <small className="local-note">В этом срезе текст хранится до перезагрузки. Постоянное хранение появится с API.</small>
        </section>

        <section className="material-panel">
          <div className="material-tabs">
            <button className="is-active" type="button">Фразы <span>{items.length}</span></button>
            <button type="button">Тексты <span>{sources.length}</span></button>
            <button type="button">Ошибки <span>3</span></button>
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти фразу или мысль"
              type="search"
              value={query}
            />
          </label>

          {sources.map((source) => (
            <article className="source-row" key={source.id}>
              <span className="source-icon"><BookOpenText size={18} /></span>
              <span>
                <strong>{source.title}</strong>
                <small>{source.sentenceCount} предложений · ожидает обработки</small>
              </span>
            </article>
          ))}

          <div className="phrase-list">
            {visibleItems.map((item, index) => (
              <article className="phrase-row" key={item.id}>
                <span className="phrase-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="phrase-copy">
                  <strong>{item.target}</strong>
                  <small>{item.cue}</small>
                </span>
                <button aria-label="Послушать" className="icon-button" type="button">
                  <Volume2 size={17} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
