import { Fragment } from "react";
import { normalizeNfc } from "../../../contracts/text";

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function FocusedText({ focusTerms, text }: { focusTerms: string[]; text: string }) {
  const normalized = normalizeNfc(text);
  const words = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const terms = [...new Set(focusTerms.map((term) => normalizeNfc(term.trim())).filter(Boolean))]
    .filter((term) => words(term) !== words(normalized) && normalized.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
    .sort((left, right) => right.length - left.length);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${terms.map(escapePattern).join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const termSet = new Set(terms.map((term) => term.toLocaleLowerCase()));
  const parts = normalized.split(pattern);
  if (!parts.some((part) => !termSet.has(part.toLocaleLowerCase()) && words(part))) return <>{text}</>;
  return <>{parts.map((part, index) => termSet.has(part.toLocaleLowerCase())
    ? <mark className="focused-text" key={`${part}:${index}`}>{part}</mark>
    : <Fragment key={`${part}:${index}`}>{part}</Fragment>)}</>;
}
