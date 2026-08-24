import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopicProgress } from "./LearningProgress";

describe("Topic progress", () => {
  it("explains that New cards have not been recalled yet", () => {
    const markup = renderToStaticMarkup(<TopicProgress progress={{
      new: 3,
      learning: 0,
      due: 0,
      strong: 0,
      learned: 0,
      dueNow: 0,
      recalls: 0,
      listens: 3,
    }} />);

    expect(markup).toContain("0 due · 3 not recalled yet");
  });
});
