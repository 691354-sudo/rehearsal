import type { ReactNode } from "react";

const renderInlineMarkdown = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
  part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);

const renderMarkdownBlocks = (content: string, keyPrefix: string) => {
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 className="simple-message-heading" key={`${keyPrefix}-heading-${index}`}>{renderInlineMarkdown(heading[1])}</h3>);
      index += 1; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, "")); index += 1;
      }
      nodes.push(<ul key={`${keyPrefix}-list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    nodes.push(<p key={`${keyPrefix}-paragraph-${index}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{renderInlineMarkdown(part)}{partIndex < paragraph.length - 1 ? <br /> : null}</span>)}</p>);
  }
  return nodes;
};

export const splitTutorCorrection = (content: string, learnerMessage?: string) => {
  const explicitHeading = /^\s*#{1,3}\s+Correction\s*$/im.exec(content);
  if (explicitHeading?.index !== undefined) return {
    reply: content.slice(0, explicitHeading.index).trim(),
    correction: content.slice(explicitHeading.index + explicitHeading[0].length).trim(),
  };

  const legacyMarker = /\b(?:More natural|A natural way to say it is)\s*:\s*/i.exec(content);
  if (legacyMarker?.index === undefined) return null;
  const correction = content.slice(legacyMarker.index + legacyMarker[0].length).trim();
  return {
    reply: content.slice(0, legacyMarker.index).trim(),
    correction: learnerMessage?.trim() ? `${learnerMessage.trim()}\n\n${correction}` : correction,
  };
};

export function TutorMarkdownMessage({ content, learnerMessage }: { content: string; learnerMessage?: string }) {
  const correction = splitTutorCorrection(content, learnerMessage);
  if (!correction) return <div className="simple-message-copy">{renderMarkdownBlocks(content, "message")}</div>;

  return <div className="simple-message-copy simple-message-copy--structured">
    {correction.reply ? <div className="simple-tutor-reply">{renderMarkdownBlocks(correction.reply, "reply")}</div> : null}
    <section className="simple-correction">
      <h3>Correction</h3>
      <div className="simple-correction-copy">{renderMarkdownBlocks(correction.correction, "correction")}</div>
    </section>
  </div>;
}
