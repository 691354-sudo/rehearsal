import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewBatchPanel, type ReviewBatch } from "./ReviewBatchPanel";

const batch = {
  publicId: "batch-1",
  language: "en",
  title: "Tutor review",
  kind: "chat_review",
  candidates: Array.from({ length: 9 }, (_, index) => ({
    id: `candidate-${index + 1}`,
    target: `Target sentence ${index + 1}`,
    cue: `Подсказка ${index + 1}`,
    note: "",
    category: "Conversation",
    focusTerms: [],
    frequencyBand: "core",
    currency: "current",
    personaFit: 1,
    naturalness: 1,
    commonness: 1,
  })),
  status: "draft",
  destinationTopicTitle: null,
} satisfies ReviewBatch;

describe("Review batch feed", () => {
  it("renders every proposal in one vertical feed without page controls", () => {
    const markup = renderToStaticMarkup(<ReviewBatchPanel batch={batch} context="tutor" feed onBatch={() => undefined} />);

    expect(markup.match(/simple-review-candidate/g)).toHaveLength(9);
    expect(markup).toContain("Target sentence 1");
    expect(markup).toContain("Target sentence 9");
    expect(markup).not.toContain("Candidate pages");
  });

  it("explains an empty Tutor review without implying anything was saved", () => {
    const markup = renderToStaticMarkup(<ReviewBatchPanel batch={{ ...batch, candidates: [] }}
      context="tutor" feed onBatch={() => undefined} />);

    expect(markup).toContain("No cards were proposed. Your chat is still here.");
    expect(markup).not.toContain("0 of 0 selected");
    expect(markup).not.toContain("Add selected");
  });
  it("keeps the original Notebook source available without guessing a provider failure", () => {
    const markup = renderToStaticMarkup(<ReviewBatchPanel batch={{ ...batch, candidates: [], kind: "capture" }}
      context="notebook" feed onBatch={() => undefined} onReset={async () => undefined} source={<p>Original note</p>} />);
    expect(markup).toContain("Original note");
    expect(markup).toContain("Reset");
    expect(markup).not.toContain("Connect OpenAI");
    expect(markup).not.toContain("Add to Library");
  });
});
