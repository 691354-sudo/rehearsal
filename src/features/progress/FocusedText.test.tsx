import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FocusedText } from "./FocusedText";

describe("FocusedText", () => {
  it("does not emphasize a whole sentence or infer a missing focus", () => {
    for (const focusTerms of [["I set out to learn"], ["I set out to learn."], ["I", "set out", "to", "learn"], ["get through"], []]) {
      expect(renderToStaticMarkup(<FocusedText focusTerms={focusTerms} text="I set out to learn." />)).not.toContain("<mark");
    }
  });
  it("matches the explicit expression, not part of an unrelated word", () => {
    const markup = renderToStaticMarkup(<FocusedText focusTerms={["get", "set out"]} text="Don't forget why we set out." />);
    expect(markup.match(/class="focused-text"/g)).toHaveLength(1);
    expect(markup).toContain(">set out<");
  });
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
