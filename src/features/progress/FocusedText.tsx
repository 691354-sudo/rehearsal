import { Fragment } from "react";
import { normalizeNfc } from "../../../contracts/text";

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function FocusedText({ focusTerms, text }: { focusTerms: string[]; text: string }) {
  const terms = [...new Set(focusTerms.map((term) => normalizeNfc(term.trim())).filter(Boolean))]
    .filter((term) => normalizeNfc(text).toLocaleLowerCase().includes(term.toLocaleLowerCase()))
    .sort((left, right) => right.length - left.length);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(escapePattern).join("|")})`, "giu");
  const termSet = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return <>{normalizeNfc(text).split(pattern).map((part, index) => termSet.has(part.toLocaleLowerCase())
    ? <mark className="focused-text" key={`${part}:${index}`}>{part}</mark>
    : <Fragment key={`${part}:${index}`}>{part}</Fragment>)}</>;
}
