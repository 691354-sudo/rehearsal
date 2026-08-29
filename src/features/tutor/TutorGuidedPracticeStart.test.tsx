import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TutorGuidedPracticeStart } from "./TutorGuidedPracticeStart";

describe("Tutor guided practice start", () => {
  it("offers one primary start and one exercise choice without starting automatically", () => {
    const markup = renderToStaticMarkup(<TutorGuidedPracticeStart disabled={false} onStart={() => undefined} />);

    expect(markup).toContain("Let Tutor lead");
    expect(markup).toContain("Start for me");
    expect(markup).toContain("Choose an exercise");
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).not.toContain("disabled");
  });
});
