import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import type { AttemptEvaluation } from "../types/practice";

type DiffResultProps = {
  evaluation: AttemptEvaluation;
  note?: string;
};

const verdictCopy = {
  exact: {
    title: "Точно",
    body: "Фраза собрана правильно. Теперь произнеси её вслух.",
    icon: CheckCircle2,
  },
  close: {
    title: "Почти",
    body: "Смысл и большая часть структуры на месте. Посмотри на выделения.",
    icon: Sparkles,
  },
  retry: {
    title: "Ещё один подход",
    body: "Сверь структуру с естественным вариантом и повтори вслух.",
    icon: AlertCircle,
  },
};

export function DiffResult({ evaluation, note }: DiffResultProps) {
  const copy = verdictCopy[evaluation.verdict];
  const VerdictIcon = copy.icon;

  return (
    <section className={`result-panel result-panel--${evaluation.verdict}`} aria-live="polite">
      <div className="result-heading">
        <span className="result-icon" aria-hidden="true">
          <VerdictIcon size={18} />
        </span>
        <div>
          <strong>{copy.title}</strong>
          <p>{copy.body}</p>
        </div>
        <span className="accuracy">{Math.round(evaluation.accuracy * 100)}%</span>
      </div>

      <div className="diff-block">
        <span className="eyebrow">Твой ответ</span>
        <p className="diff-line">
          {evaluation.answerTokens.map((token, index) => (
            <span className={`diff-token diff-token--${token.status}`} key={`${token.value}-${index}`}>
              {token.value}
            </span>
          ))}
        </p>
      </div>

      <div className="diff-block diff-block--target">
        <span className="eyebrow">Естественный вариант</span>
        <p className="diff-line">
          {evaluation.expectedTokens.map((token, index) => (
            <span className={`diff-token diff-token--${token.status}`} key={`${token.value}-${index}`}>
              {token.value}
            </span>
          ))}
        </p>
      </div>

      {note ? <p className="language-note">{note}</p> : null}
      <p className="prototype-note">
        Сейчас показано точное сравнение по словам. Оценка смысла и naturalness будет подключена через LLM.
      </p>
    </section>
  );
}
