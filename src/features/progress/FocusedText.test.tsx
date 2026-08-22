import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FocusedText } from "./FocusedText";

describe("FocusedText", () => {
  it("highlights every exact occurrence of every focus term", () => {
    const markup = renderToStaticMarkup(<FocusedText
      focusTerms={["pull through", "enough"]}
      text="I can pull through with enough rest, then pull through again."
    />);
    expect(markup.match(/class="focused-text"/g)).toHaveLength(3);
    expect(markup).toContain(">pull through<");
    expect(markup).toContain(">enough<");
  });
});
