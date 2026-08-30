import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TutorGuidedPracticeStart } from "./TutorGuidedPracticeStart";

describe("Tutor guided practice start", () => {
  it("explains every exercise beside one separate automatic start", () => {
    const markup = renderToStaticMarkup(<TutorGuidedPracticeStart disabled={false} onStart={() => undefined} />);

    expect(markup).toContain("Choose an exercise");
    expect(markup).toContain("Start for me");
    expect(markup).toContain("Tutor checks what is due");
    expect(markup).toContain("Tell it better");
    expect(markup).toContain("Say one thought, repair it");
    expect(markup).toContain("Recall &amp; reuse");
    expect(markup).toContain("Role-play twice");
    expect(markup).toContain("Read → retell");
    expect(markup.match(/<button/g)).toHaveLength(5);
    expect(markup).not.toContain("disabled");
  });
});
