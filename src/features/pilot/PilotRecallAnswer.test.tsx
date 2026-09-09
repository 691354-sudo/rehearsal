import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RecallCheck } from "../../../contracts/recall-check";
import { PilotRecallAnswer } from "./PilotRecallAnswer";

const reference = "I don't quite follow—could you explain it another way?";
const render = (answer: string, saved?: RecallCheck) => renderToStaticMarkup(
  <PilotRecallAnswer profileId="roman" attemptId="attempt" answer={answer} reference={reference}
    saved={saved} onChecked={() => undefined} />);
const correct: RecallCheck = { verdict: "correct", explanationRu: "Старый сохранённый комментарий.", correctedAnswer: reference, mistakes: [] };

describe("Recall answer feedback", () => {
  it("shows a green match without a generated comment, including saved older checks", () => {
    const markup = render(reference.toUpperCase(), correct);
    expect(markup).toContain("pilot-answer-check--correct");
    expect(markup).toContain("Correct");
    expect(markup).not.toContain("pilot-check-explanation");
    expect(markup).not.toContain(correct.explanationRu);
  });
  it("shows valid different wording in amber with a fixed explanation instead of AI praise", () => {
    const markup = render("I don't understand - can you rephrase it?", correct);
    expect(markup).toContain("pilot-answer-check--alternative");
    expect(markup).toContain("Valid alternative");
    expect(markup).toContain("This works too. The card uses different wording.");
    expect(markup).not.toContain("pilot-answer-check--correct");
    expect(markup).not.toContain(correct.explanationRu);
    expect(markup).not.toContain("pilot-check-correction");
  });
  it("keeps errors red with their explanation, literal highlighting and correction", () => {
    const markup = render("I doesn't understand.", { verdict: "incorrect", explanationRu: "После I нужна форма don't.",
      correctedAnswer: "I don't understand.", mistakes: [{ original: "doesn't", correction: "don't" }] });
    expect(markup).toContain("pilot-answer-check--incorrect");
    expect(markup).toContain("Needs a correction");
    expect(markup).toContain("После I нужна форма");
    expect(markup).toContain("<mark>");
    expect(markup).toContain("pilot-check-correction");
  });
  it("keeps oral and pending checks neutral", () => {
    expect(render("")).toContain("pilot-answer-check--oral");
    expect(render("Another wording.")).toContain("pilot-answer-check--checking");
  });
});
