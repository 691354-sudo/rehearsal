import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TutorMarkdownMessage } from "./TutorMarkdownMessage";

describe("English Tutor semantic parts", () => {
  it("keeps conversation plain and separates only supplied semantic sections", () => {
    const markup = renderToStaticMarkup(<TutorMarkdownMessage semantic content={'Понимаю тебя.\n\n### Your phrase\n\nI goes home.\n\n### Correction\n\nI **go** home.\n\n### Why\n\nПосле I — go.\n\n### Your turn\n'} />);
    expect(markup).toContain('data-part="your phrase"'); expect(markup).toContain('data-part="correction"');
    expect(markup).toContain('data-part="why"'); expect(markup).not.toContain('data-part="your turn"');
    expect(markup).toContain('<strong>go</strong>');
    const plain = renderToStaticMarkup(<TutorMarkdownMessage semantic content="Расскажи, как прошёл день." />);
    expect(plain).not.toContain("pilot-tutor-section");
  });
  it("escapes learner text without converting it to HTML", () => {
    const markup = renderToStaticMarkup(<TutorMarkdownMessage semantic content={'### Your phrase\n\n<script>alert(1)</script>'} />);
    expect(markup).toContain("&lt;script&gt;"); expect(markup).not.toContain("<script>");
  });
});
