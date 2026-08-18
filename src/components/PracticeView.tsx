import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Headphones,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  Volume2,
} from "lucide-react";
import { languageMeta } from "../data/practiceItems";
import { useSpeech, type SpeechPart } from "../hooks/useSpeech";
import { evaluateAttempt } from "../lib/compare";
import type {
  AttemptEvaluation,
  LanguageCode,
  PracticeItem,
  PracticeMode,
  PracticeSettings,
} from "../types/practice";
import { DiffResult } from "./DiffResult";

type PracticeViewProps = {
  language: LanguageCode;
  items: PracticeItem[];
  settings: PracticeSettings;
  onOpenSettings: () => void;
};

const modeCopy: Record<PracticeMode, { label: string; short: string }> = {
  recall: { label: "Вспомнить и написать", short: "Recall" },
  shadow: { label: "Слушать и повторять", short: "Shadow" },
  listen: { label: "Непрерывное прослушивание", short: "Listen" },
};

const statusRank: Record<PracticeItem["status"], number> = {
  learning: 0,
  new: 1,
  strong: 2,
};

const orderItems = (items: PracticeItem[], settings: PracticeSettings) => {
  if (settings.sortMode === "original") return items;
  if (settings.sortMode === "shuffle") {
    return [...items].sort((a, b) =>
      a.id.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0) -
      b.id.split("").reduce((sum, letter) => sum + letter.charCodeAt(0), 0),
    );
  }

  const ranks =
    settings.sortMode === "new-first"
      ? { new: 0, learning: 1, strong: 2 }
      : statusRank;
  return [...items].sort((a, b) => ranks[a.status] - ranks[b.status]);
};

export function PracticeView({
  language,
  items,
  settings,
  onOpenSettings,
}: PracticeViewProps) {
  const [mode, setMode] = useState<PracticeMode>("recall");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<AttemptEvaluation | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const { isSpeaking, speak, speakSequence, stop } = useSpeech();

  const orderedItems = useMemo(() => orderItems(items, settings), [items, settings]);
  const item = orderedItems[currentIndex] ?? orderedItems[0];
  const meta = languageMeta[language];

  useEffect(() => {
    setCurrentIndex(0);
    setAnswer("");
    setEvaluation(null);
    setSessionComplete(false);
    stop();
  }, [language, settings.sortMode, stop]);

  useEffect(() => {
    if (mode === "recall" && !evaluation) answerRef.current?.focus();
  }, [currentIndex, evaluation, mode]);

  const goNext = () => {
    stop();
    setAnswer("");
    setEvaluation(null);
    if (currentIndex >= orderedItems.length - 1) {
      if (settings.loopQueue) setCurrentIndex(0);
      else setSessionComplete(true);
      return;
    }
    setCurrentIndex((index) => index + 1);
  };

  const changeMode = (nextMode: PracticeMode) => {
    stop();
    setMode(nextMode);
    setAnswer("");
    setEvaluation(null);
    setSessionComplete(false);
  };

  const checkAnswer = () => {
    if (!answer.trim()) return;
    setEvaluation(evaluateAttempt(item, answer));
  };

  const buildSpeechParts = (): SpeechPart[] => {
    const target: SpeechPart = {
      text: item.target,
      locale: meta.locale,
      rate: settings.playbackRate,
    };
    const cue: SpeechPart = {
      text: item.cue,
      locale: "ru-RU",
      rate: 1,
    };

    if (settings.playbackOrder === "cue-target") {
      cue.pauseAfterMs = settings.languagePauseMs;
      return [cue, target];
    }
    if (settings.playbackOrder === "target-cue") {
      target.pauseAfterMs = settings.languagePauseMs;
      return [target, cue];
    }
    return [target];
  };

  const playCurrent = () => {
    if (isSpeaking) {
      stop();
      return;
    }

    void speakSequence(buildSpeechParts(), {
      repetitions: mode === "listen" ? 1 : settings.repetitions,
      pauseMs: settings.phrasePauseMs,
      onComplete: settings.autoAdvance ? goNext : undefined,
    });
  };

  const repeatAnswer = () => {
    const target = evaluation?.expected ?? item.target;
    if (isSpeaking) stop();
    else void speak(target, { locale: meta.locale, rate: settings.playbackRate });
  };

  if (sessionComplete) {
    return (
      <div className="practice-layout">
        <section className="completion-card">
          <span className="completion-mark">
            <Check size={28} />
          </span>
          <span className="eyebrow">Сессия завершена</span>
          <h1>{orderedItems.length} фраз прошли через активную память.</h1>
          <p>
            Попытки пока сохраняются локально. После подключения учебного ядра они будут менять интервалы повторения.
          </p>
          <button
            className="primary-button"
            onClick={() => {
              setCurrentIndex(0);
              setSessionComplete(false);
            }}
            type="button"
          >
            <RotateCcw size={17} />
            Пройти ещё раз
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="practice-layout">
      <main className={`practice-stage text-scale--${settings.textScale}`}>
        <header className="session-header">
          <div>
            <span className="eyebrow">Сегодня · персональный набор</span>
            <h1>{modeCopy[mode].label}</h1>
          </div>
          <div className="session-count">
            <strong>{String(currentIndex + 1).padStart(2, "0")}</strong>
            <span>/ {String(orderedItems.length).padStart(2, "0")}</span>
          </div>
        </header>

        <div className="rehearsal-rail" aria-label="Режим практики">
          <div className="mode-switcher">
            {(Object.keys(modeCopy) as PracticeMode[]).map((modeKey) => (
              <button
                aria-label={modeCopy[modeKey].short}
                className={mode === modeKey ? "mode-button is-active" : "mode-button"}
                key={modeKey}
                onClick={() => changeMode(modeKey)}
                type="button"
              >
                {modeKey === "recall" ? <Keyboard size={17} /> : null}
                {modeKey === "shadow" ? <Volume2 size={17} /> : null}
                {modeKey === "listen" ? <Headphones size={17} /> : null}
                <span>{modeCopy[modeKey].short}</span>
              </button>
            ))}
          </div>
          <button aria-label="Ритм" className="settings-button" onClick={onOpenSettings} type="button">
            <Settings2 size={18} />
            <span>Ритм</span>
          </button>
        </div>

        <section className="cue-card">
          <div className="cue-meta">
            <span>{mode === "recall" ? "Подсказка на русском" : item.source}</span>
            <span className={`status-dot status-dot--${item.status}`}>
              {item.status === "new" ? "Новая" : item.status === "learning" ? "В работе" : "Сильная"}
            </span>
          </div>

          {mode === "recall" ? (
            <>
              <p className="cue-text">{item.cue}</p>
              <label className="answer-field">
                <span>Напиши так, как сказал бы это в разговоре</span>
                <textarea
                  disabled={Boolean(evaluation)}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") checkAnswer();
                  }}
                  placeholder={`${meta.label}…`}
                  ref={answerRef}
                  rows={3}
                  value={answer}
                />
              </label>

              {!evaluation ? (
                <div className="attempt-actions">
                  <span className="keyboard-hint">⌘ Enter</span>
                  <button className="primary-button" disabled={!answer.trim()} onClick={checkAnswer} type="button">
                    Проверить
                    <ArrowRight size={17} />
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="shadow-content">
              <span className="eyebrow">Слушай · пауза · повторяй</span>
              <p className="target-script">{item.target}</p>
              {settings.showTranslation ? <p className="shadow-cue">{item.cue}</p> : null}
              <button className={isSpeaking ? "play-orbit is-playing" : "play-orbit"} onClick={playCurrent} type="button">
                <span>{isSpeaking ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}</span>
                <strong>{isSpeaking ? "Остановить" : mode === "listen" ? "Слушать" : "Начать повтор"}</strong>
                <small>
                  {settings.repetitions}× · {settings.playbackRate.toFixed(2)} speed · {settings.phrasePauseMs / 1000}s pause
                </small>
              </button>
            </div>
          )}
        </section>

        {evaluation ? <DiffResult evaluation={evaluation} note={item.note} /> : null}

        <footer className="stage-footer">
          <button className="quiet-button" onClick={repeatAnswer} type="button">
            {isSpeaking ? <Pause size={17} /> : <Volume2 size={17} />}
            {evaluation ? "Послушать ответ" : "Послушать фразу"}
          </button>
          {evaluation || mode !== "recall" ? (
            <button className="primary-button" onClick={goNext} type="button">
              Следующая
              <ChevronRight size={18} />
            </button>
          ) : null}
        </footer>
      </main>

      <aside className="session-queue">
        <div className="queue-heading">
          <div>
            <span className="eyebrow">Репетиционная дорожка</span>
            <h2>Дальше</h2>
          </div>
          <Sparkles size={18} />
        </div>
        <div className="queue-list">
          {orderedItems.map((queueItem, index) => (
            <button
              className={index === currentIndex ? "queue-item is-current" : "queue-item"}
              key={queueItem.id}
              onClick={() => {
                stop();
                setCurrentIndex(index);
                setAnswer("");
                setEvaluation(null);
              }}
              type="button"
            >
              <span className="queue-number">{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{queueItem.target}</strong>
                <small>{queueItem.source}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
