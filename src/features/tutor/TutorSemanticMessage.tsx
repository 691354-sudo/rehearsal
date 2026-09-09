import { renderMarkdownBlocks, splitTutorCorrection } from "./TutorMarkdownMessage";

type TutorPart = { label: string; content: string };
const headingPattern = /^\s*#{1,3}\s+(Feedback|Your phrase|Correction|Another option|Why|Meaning|Your turn|Next task)\s*$/gim;
const isTask = (part: TutorPart) => /^(your turn|next task)$/i.test(part.label);

export function splitTutorSections(content: string, learnerMessage?: string) {
  const matches = [...content.matchAll(headingPattern)];
  let reply = matches.length ? content.slice(0, matches[0].index).trim() : content;
  let sections: TutorPart[] = matches.map((match, index) => ({ label: match[1].toLowerCase(),
    content: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).trim(),
  })).filter((section) => section.content);
  if (!matches.length) {
    const legacy = splitTutorCorrection(content, learnerMessage);
    if (legacy) { reply = legacy.reply; sections = [{ label: "correction", content: legacy.correction }]; }
  }
  sections = sections.flatMap((section) => {
    const blocks = section.content.split(/\n\s*\n/).filter(Boolean);
    if (section.label !== "correction" || blocks.length < 2
      || learnerMessage?.trim() !== blocks[0].replace(/^\*\*|\*\*$/g, "").trim()) return [section];
    return [{ label: "your phrase", content: blocks[0] }, { label: "correction", content: blocks[1] },
      ...(blocks.length > 2 ? [{ label: "why", content: blocks.slice(2).join("\n\n") }] : [])];
  });
  const parts = [...(reply.trim() ? [{ label: "feedback", content: reply }] : []), ...sections];
  const feedback: TutorPart[] = [];
  const tasks: TutorPart[] = [];
  for (const part of parts) {
    if (isTask(part)) { tasks.push(part); continue; }
    // Old Homework replies placed an explicit translation prompt before Your turn.
    const prompt = part.label === "feedback" ? /(?:^|\n)(Переведи[^\n:]*:)\s*\n[«“"]([^»”"]+)[»”"]\s*$/i.exec(part.content) : null;
    if (prompt) {
      const preceding = part.content.slice(0, prompt.index).trim();
      if (preceding) feedback.push({ ...part, content: preceding });
      tasks.push({ label: "next task", content: `${prompt[1]}\n\n> ${prompt[2].trim()}` });
    } else feedback.push(part);
  }
  return { feedback, tasks };
}

export function TutorSemanticMessage({ content, learnerMessage }: { content: string; learnerMessage?: string }) {
  const { feedback, tasks } = splitTutorSections(content, learnerMessage);
  if (!content.match(headingPattern) && !tasks.length && feedback.every((part) => part.label === "feedback")) {
    return <div className="simple-message-copy tutor-message-copy">{renderMarkdownBlocks(content, "reply", true)}</div>;
  }
  const renderParts = (parts: TutorPart[]) => parts.map((part, index) =>
    <div className="tutor-response-part" data-part={part.label} key={index}>{renderMarkdownBlocks(part.content, `part-${index}`, true)}</div>);
  return <div className="simple-message-copy tutor-message-copy">
    {feedback.length ? <section className="tutor-response-section" data-section="feedback">
      <h2>Feedback</h2>{renderParts(feedback)}
    </section> : null}
    {tasks.length ? <section className="tutor-response-section" data-section="task">
      <h2>Next Task</h2>{renderParts(tasks)}
    </section> : null}
  </div>;
}
