import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { PracticeQueuePreview } from "./PracticeQueuePreview";

const item = {
  publicId: "card-1",
  language: "en",
  kind: "phrase",
  target: "Ultimately, it's your choice.",
  cue: "В конечном счёте решать тебе.",
  acceptedAnswers: [],
  note: "",
  source: "test",
  status: "new",
  preference: "neutral",
  naturalness: 1,
  commonness: 1,
  register: "neutral",
  tags: [],
  focusTerms: [],
  frequencyBand: "core",
  currency: "current",
  personaFit: 1,
  relevanceCheckedAt: null,
  practiceEnabled: true,
  progress: { stage: "new", recalls: 0, listens: 6 },
} satisfies LearningItem;

describe("Practice queue preview", () => {
  it("uses the same compact progress and action row for Listen cards", () => {
    const markup = renderToStaticMarkup(<PracticeQueuePreview items={[item]} language="en" mode="listen"
      onEdit={() => undefined} onPlay={async () => undefined} scope="custom" />);
    const side = markup.slice(markup.indexOf("practice-queue-side"), markup.indexOf("</li>"));

    expect(markup).toContain("<span>1 card</span>");
    expect(side).toContain("learning-progress");
  });
});

const focusedItem = { ...item, target: "I set out to understand what happened.", focusTerms: ["set out"] };
const renderRecall = (evaluation?: import("../../shared/contracts").Evaluation) => renderToStaticMarkup(<PracticeQueuePreview
  items={[focusedItem]} language="en" mode="recall" scope="custom" attempts={{ "card-1": { answer: "test", evaluation } }}
  onAnswer={() => undefined} onCheck={() => undefined} onEdit={() => undefined} onPlay={async () => undefined} onRecallReview={async () => true} />);

describe("Focus in Practice lists", () => {
  it("marks only the stored phrase in the Listen list", () => {
    const html = renderToStaticMarkup(<PracticeQueuePreview items={[focusedItem]} language="en" mode="listen" scope="custom" onEdit={() => undefined} onPlay={async () => undefined} />);
    expect(html).toContain('<mark class="focused-text">set out</mark>');
  });
  it("keeps the Recall prompt free of answer hints", () => {
    expect(renderRecall()).not.toContain('<mark');
  });
  it.each(["exact", "close", "retry"] as const)("marks a phrase spanning words in the revealed %s answer", (verdict) => {
    expect(renderRecall({ verdict, score: 0, naturalAnswer: focusedItem.target, correctedAnswer: "", summaryRu: "", mistakes: [] })).toContain('<mark class="focused-text">set out</mark>');
  });
});
