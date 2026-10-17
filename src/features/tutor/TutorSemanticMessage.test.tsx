import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TutorMarkdownMessage } from "./TutorMarkdownMessage";
import { TutorChatMessage } from "./TutorChatMessage";

const renderReply = (content: string, learnerMessage?: string) => renderToStaticMarkup(
  <TutorMarkdownMessage semantic content={content} learnerMessage={learnerMessage} />);

describe("Tutor response layout", () => {
  it("lightly marks complete quoted corrections without changing feedback, task or user copy", () => {
    const feedback = 'Your meaning is clear. Small correction: “I think we’d be better off travelling with different people,” and “you seem comfortable staying at the hotel.”';
    const markup = renderReply(`### Feedback\n${feedback}\n\n### Next Task\nExplain “what connects them”.`);
    expect(markup.match(/class="tutor-inline-correction"/g)).toHaveLength(2);
    expect(markup).toContain('<em class="tutor-inline-correction">I think we’d be better off travelling with different people,</em>');
    expect(markup).toContain('Your meaning is clear.');
    expect(markup.slice(markup.indexOf('<h2>Next Task'))).not.toContain('<em');
    expect(renderReply('You said “I go home.” That is correct.')).not.toContain('<em');
    const user = renderToStaticMarkup(<TutorMarkdownMessage content={feedback} />);
    expect(user).not.toContain('<em');
  });
  it("does not mark unrelated later quotes or inject HTML from a correction", () => {
    const markup = renderReply('### Feedback\nCorrection: "<img src=x>". The word "work" is useful.');
    expect(markup.match(/class="tutor-inline-correction"/g)).toHaveLength(1);
    expect(markup).toContain('&lt;img src=x&gt;');
    expect(markup).not.toContain('<img');
  });
  it("separates the existing follow-up question in saved ordinary conversation", () => {
    const markup = renderReply("Sure, let's talk.\n\nWhat's been going on in your life lately?");
    expect(markup).toContain("Sure, let&#x27;s talk.");
    expect(markup.match(/<p>/g)).toHaveLength(2);
    expect(markup.match(/<h2>.*?<\/h2>/g)).toEqual(["<h2>Feedback</h2>", "<h2>Next Task</h2>"]);
    expect(markup.indexOf("What&#x27;s been going on")).toBeGreaterThan(markup.indexOf("Next Task"));
  });
  it.each(["\n", " "])("restores the saved trading reply with its whole correction and original emphasis (%j)", (separator) => {
    const feedback = "Exactly. The alluring image is freedom and effortless money, but the reality is constant uncertainty, self-control, and responsibility. A beach may be a nice place to check your positions occasionally, but probably not the best place to make difficult decisions with real money at stake.";
    const reflection = "It sounds as if trading became less alluring once you understood what consistent profitability actually requires.";
    const question = "Has the reality made trading less attractive to you, or has it just changed what you find attractive about it?";
    const markup = renderReply(`${feedback}\n\nSmall tweak: “Whether they can sustain **that kind of lifestyle** is a big question.”\n\n${reflection}${separator}${question}`);
    expect(markup).toContain(feedback);
    expect(markup).toContain(reflection);
    expect(markup).toContain('<em class="tutor-inline-correction">Whether they can sustain <strong>that kind of lifestyle</strong> is a big question.</em>');
    expect(markup.match(/<p>/g)).toHaveLength(4);
    expect(markup.match(/<h2>.*?<\/h2>/g)).toEqual(["<h2>Feedback</h2>", "<h2>Next Task</h2>"]);
    expect(markup.slice(markup.indexOf('<h2>Next Task'))).toContain(question);
  });
  it.each([
    'Small tweak: “How are **you** doing?”',
    'You can ask:\nHow are you doing?',
    'Two examples:\n- How are you doing?\n- Where do you live?',
    'An example:\n\n> Where do you live?',
    '### Feedback\nThe question is:\nHow are you doing?',
    'The word **alluring** means attractive.\n\nIt describes something tempting.',
  ])("does not invent a next task from explanations, examples or explicit feedback (%s)", (content) => {
    const markup = renderReply(content);
    expect(markup).toContain('<h2>Feedback</h2>');
    expect(markup).not.toContain('<h2>Next Task</h2>');
  });
  it("groups feedback, alternatives and reasons under one heading with a separate next task", () => {
    const markup = renderReply('Понимаю тебя.\n\n### Your phrase\n\nI goes home.\n\n### Correction\n\nI **go** home.\n\n### Why\n\nПосле I — go.\n\n### Your turn\n\nНапиши фразу снова.');
    expect(markup.match(/<h2>.*?<\/h2>/g)).toEqual(["<h2>Feedback</h2>", "<h2>Next Task</h2>"]);
    expect(markup).toContain('data-part="correction"');
    expect(markup).toContain('data-part="why"');
    expect(markup).toContain('<strong>go</strong>');
    expect(markup.indexOf("После I")).toBeLessThan(markup.indexOf("Next Task"));
    expect(markup).not.toContain("simple-tutor-reply");
  });
  it("renders a task cue separately without exposing Markdown", () => {
    const markup = renderReply('### Feedback\n\nВерно.\n\n### Another option\n\nI **went** home.\n\n### Why\n\n*Went* — прошедшее время.\n\n### Next Task\n\nПереведи по памяти.\n\n> Я пошёл домой.');
    expect(markup).toContain("<em>Went</em>");
    expect(markup).toContain("<blockquote>");
    expect(markup).not.toContain("###");
    expect(markup).not.toContain("**");
    expect(markup.match(/<section /g)).toHaveLength(2);
  });
  it("moves the explicit translation prompt from old Homework feedback into the task", () => {
    const markup = renderReply('Две фразы уже воспроизведены.\nПереведи естественно на английский:\n«Я замечаю, что повторение помогает»\n\n### Your turn\n\nНапиши всю фразу по памяти.');
    expect(markup.indexOf("Две фразы")).toBeLessThan(markup.indexOf("Next Task"));
    expect(markup.indexOf("Переведи естественно")).toBeGreaterThan(markup.indexOf("Next Task"));
    expect(markup).toContain("<blockquote>");
    expect(markup).toContain("Я замечаю, что повторение помогает");
    expect(markup).toContain("Напиши всю фразу по памяти.");
  });
  it("keeps older correction paragraphs together without losing the learner phrase", () => {
    const markup = renderReply('Nice.\n\n### Correction\n\nI goes home.\n\n**I go home.**\n\nUse go after I.', "I goes home.");
    expect(markup).toContain('data-part="your phrase"');
    expect(markup).toContain('data-part="correction"');
    expect(markup).toContain('data-part="why"');
    expect(markup.match(/<h2>/g)).toHaveLength(1);
    expect(markup).not.toContain("Next Task");
  });
  it("preserves plain saved replies, omits empty sections, and escapes HTML", () => {
    const markup = renderReply('Расскажи, как прошёл день.\n\n### Next Task\n');
    expect(markup).toContain("Расскажи, как прошёл день.");
    expect(markup).not.toContain("Next Task");
    const escaped = renderReply('### Feedback\n\n<script>alert(1)</script>\n\n### Next Task\n\n> <img src=x onerror=alert(1)>');
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("<img");
  });
  it("uses the assistant layout without a language label and leaves user content out of it", () => {
    const props = { onDelete: () => undefined, onEdit: () => undefined, onRetry: () => undefined };
    const content = '### Feedback\n\nВерно.\n\n### Next Task\n\nНапиши ещё пример.';
    const assistant = renderToStaticMarkup(<TutorChatMessage {...props} message={{ id: "1", role: "assistant", content }} />);
    const user = renderToStaticMarkup(<TutorChatMessage {...props} message={{ id: "2", role: "user", content: "Why is this correct?" }} />);
    expect(assistant).not.toContain("English");
    expect(assistant).toContain("Next Task");
    expect(user).not.toContain("Feedback");
  });
});
