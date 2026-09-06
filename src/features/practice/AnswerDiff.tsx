import { FocusedText } from "../progress/FocusedText";
import type { DiffToken } from "../../types/practice";
import { Volume2 } from "lucide-react";

const Token = ({ token }: { token: DiffToken }) => {
  if (token.status === "extra") return <del>{token.value}</del>;
  if (token.status === "missing") return <mark className="answer-diff-missing">{token.value}</mark>;
  return <span className={token.status === "changed" ? "answer-diff-changed" : undefined}>{token.value}</span>;
};

export function AnswerDiff({ answerTokens = [], expectedTokens = [], language, onPlay, naturalAnswer, focusTerms = [] }: {
  answerTokens?: DiffToken[];
  expectedTokens?: DiffToken[];
  language: string;
  naturalAnswer?: string;
  focusTerms?: string[];
  onPlay?: () => void;
}) {
  return <div className="answer-diff">
    <p lang={language}><small>You</small><span>{answerTokens.map((token, index) => <Token key={index} token={token} />)}</span></p>
    <p lang={language}><small>Natural</small><span>{naturalAnswer ? <span><FocusedText text={naturalAnswer} focusTerms={focusTerms} /></span> : expectedTokens.map((token, index) => <span key={index}>{token.value}</span>)}</span>
      {onPlay ? <button aria-label="Play natural answer" onClick={onPlay} title="Play" type="button"><Volume2 size={15} /></button> : null}</p>
  </div>;
}
