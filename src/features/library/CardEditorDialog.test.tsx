import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { CardEditorDialog } from "./CardEditorDialog";

const item = {
  publicId: "card-1",
  language: "en",
  kind: "phrase",
  target: "I cut him short because I already knew what he was talking about.",
  cue: "Я его перебил, потому что я и так понимал, о чём он говорил.",
  acceptedAnswers: [],
  note: "",
  source: "test",
  status: "new",
  preference: "neutral",
  naturalness: 1,
  commonness: 1,
  register: "neutral",
  tags: [],
  focusTerms: ["cut him short", "legacy hidden term"],
  frequencyBand: "common",
  currency: "current",
  personaFit: 1,
  relevanceCheckedAt: null,
  practiceEnabled: true,
  progress: { stage: "new", recalls: 0, listens: 0 },
} satisfies LearningItem;

describe("Card editor", () => {
  it("validates only the editable primary focus phrase", () => {
    const markup = renderToStaticMarkup(<CardEditorDialog item={item} language="en" onClose={() => undefined} onSaved={() => undefined} />);

    expect(markup).toContain('name="card-focus" value="cut him short"');
    expect(markup).not.toContain("Focus phrase isn’t present in the target.");
  });
});
