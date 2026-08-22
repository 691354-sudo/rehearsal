import type { DiffToken } from "../../types/practice";

const Token = ({ token }: { token: DiffToken }) => {
  const content = token.parts?.length ? token.parts.map((part, index) => part.status === "changed"
    ? <mark className="answer-diff-character" key={index}>{part.value}</mark>
    : <span key={index}>{part.value}</span>) : token.value;
  if (token.status === "extra") return <del>{content}</del>;
  if (token.status === "missing") return <mark className="answer-diff-missing">{content}</mark>;
  return <span className={token.status === "changed" ? "answer-diff-changed" : undefined}>{content}</span>;
};

export function AnswerDiff({ answerTokens = [], expectedTokens = [], language }: {
  answerTokens?: DiffToken[];
  expectedTokens?: DiffToken[];
  language: string;
}) {
  return <div className="answer-diff">
    <p lang={language}><small>You</small><span>{answerTokens.map((token, index) => <Token key={index} token={token} />)}</span></p>
    <p lang={language}><small>Natural</small><span>{expectedTokens.map((token, index) => <Token key={index} token={token} />)}</span></p>
  </div>;
}
