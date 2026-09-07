import { renderMarkdownBlocks, splitTutorCorrection } from "./TutorMarkdownMessage";

const headingPattern = /^\s*#{1,3}\s+(Your phrase|Correction|Another option|Why|Meaning|Your turn)\s*$/gim;
export function splitTutorSections(content: string, learnerMessage?: string) {
  const matches = [...content.matchAll(headingPattern)];
  if (matches.length === 1 && matches[0][1].toLowerCase() === "correction") {
    const legacy = splitTutorCorrection(content, learnerMessage);
    const blocks = legacy?.correction.split(/\n\s*\n/).filter(Boolean) ?? [];
    // Older saved replies used exactly three blocks under Correction.
    if (blocks.length === 3 && learnerMessage?.trim() === blocks[0].replace(/^\*\*|\*\*$/g, "").trim()) {
      return { reply: legacy!.reply, sections: [
        { label: "Your phrase", content: blocks[0] }, { label: "Correction", content: blocks[1] }, { label: "Why", content: blocks[2] },
      ] };
    }
  }
  return { reply: matches.length ? content.slice(0, matches[0].index).trim() : content,
    sections: matches.map((match, index) => ({ label: match[1],
      content: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).trim(),
    })).filter((section) => section.content) };
}
export function TutorSemanticMessage({ content, learnerMessage }: { content: string; learnerMessage?: string }) {
  const { reply, sections } = splitTutorSections(content, learnerMessage);
  return <div className="simple-message-copy pilot-tutor-copy">
    {reply.trim() ? <div className="simple-tutor-reply">{renderMarkdownBlocks(reply, "reply")}</div> : null}
    {sections.map((section, index) => <section className="pilot-tutor-section" data-part={section.label.toLowerCase()} key={index}>
      <h3>{section.label}</h3>{renderMarkdownBlocks(section.content, `part-${index}`)}
    </section>)}
  </div>;
}
