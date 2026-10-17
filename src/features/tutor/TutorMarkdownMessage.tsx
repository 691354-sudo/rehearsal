import type { ReactNode } from "react";
import { TutorSemanticMessage } from "./TutorSemanticMessage";

const renderInlineMarkdown = (text: string) => text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part, index) =>
  part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong>
    : part.startsWith("*") && part.endsWith("*") ? <em key={index}>{part.slice(1, -1)}</em> : part);

const renderFeedbackInline = (text: string) => {
  const cue = /\b(?:small tweak|small correction|correction|better|more natural|you (?:can|could|should) say|try saying)\s*:\s*/i.exec(text);
  if (!cue) return renderInlineMarkdown(text);
  const start = cue.index + cue[0].length;
  const result: ReactNode[] = [...renderInlineMarkdown(text.slice(0, start))];
  const rest = text.slice(start);
  let cursor = 0;
  for (const match of rest.matchAll(/[“"]([^“”"\n]+)[”"]/g)) {
    const index = match.index!;
    // Only the suggested phrase(s) immediately following the correction cue.
    if (!/^[\s,;]*(?:and\s*)?$/.test(rest.slice(cursor, index))) break;
    result.push(...renderInlineMarkdown(rest.slice(cursor, index)), match[0][0],
      <em className="tutor-inline-correction" key={`correction-${index}`}>{renderInlineMarkdown(match[1])}</em>, match[0].at(-1));
    cursor = index + match[0].length;
  }
  result.push(...renderInlineMarkdown(rest.slice(cursor)));
  return result;
};

export const renderMarkdownBlocks = (content: string, keyPrefix: string, compact = false, corrections = false) => {
  const inline = corrections ? renderFeedbackInline : renderInlineMarkdown;
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(compact ? <p className="tutor-response-subheading" key={`${keyPrefix}-heading-${index}`}><strong>{inline(heading[1])}</strong></p>
        : <h3 className="simple-message-heading" key={`${keyPrefix}-heading-${index}`}>{inline(heading[1])}</h3>);
      index += 1; continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, "")); index += 1;
      }
      nodes.push(<blockquote key={`${keyPrefix}-quote-${index}`}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, "")); index += 1;
      }
      nodes.push(<ul key={`${keyPrefix}-list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim()) && !/^>\s?/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    nodes.push(<p key={`${keyPrefix}-paragraph-${index}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{inline(part)}{partIndex < paragraph.length - 1 ? <br /> : null}</span>)}</p>);
  }
  return nodes;
};

const promoteTrailingConversationalReply = (content: string) => {
  const blocks = content.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const trailing = blocks.at(-1) || "";
  if (blocks.length < 3 || !/^(?:if you want,\s*)?we can\b|^(?:tell me|what|how|do you|would you|shall we)\b/i.test(trailing)) return null;
  return { reply: trailing, correction: blocks.slice(0, -1).join("\n\n") };
};

export const splitTutorCorrection = (content: string, learnerMessage?: string) => {
  const explicitHeading = /^\s*#{1,3}\s+Correction\s*$/im.exec(content);
  if (explicitHeading?.index !== undefined) {
    let reply = content.slice(0, explicitHeading.index).trim();
    let correction = content.slice(explicitHeading.index + explicitHeading[0].length).trim();
    if (!reply) {
      const promoted = promoteTrailingConversationalReply(correction);
      if (promoted) ({ reply, correction } = promoted);
    }
    return { reply, correction };
  }

  const legacyMarker = /\b(?:More natural|A natural way to say it is)\s*:\s*/i.exec(content);
  if (legacyMarker?.index === undefined) return null;
  let reply = content.slice(0, legacyMarker.index).trim();
  let correction = content.slice(legacyMarker.index + legacyMarker[0].length).trim();
  if (!reply) {
    const promoted = promoteTrailingConversationalReply(correction);
    if (promoted) ({ reply, correction } = promoted);
  }
  return {
    reply,
    correction: learnerMessage?.trim() ? `${learnerMessage.trim()}\n\n${correction}` : correction,
  };
};

export function TutorMarkdownMessage({ content, learnerMessage, semantic = false }: { content: string; learnerMessage?: string; semantic?: boolean }) {
  if (semantic) return <TutorSemanticMessage content={content} learnerMessage={learnerMessage} />;
  return <div className="simple-message-copy">{renderMarkdownBlocks(content, "message")}</div>;
}
