import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { pickerTarget, PracticePicker } from "./PracticePicker";

describe("Practice picker keyboard navigation", () => {
  const labels = ["Recommended · Up to 10", "Recommended · Up to 20", "All Library", "Newest first"];
  it.each([
    [3, "ArrowDown", 0], [0, "ArrowUp", 3], [2, "Home", 0], [0, "End", 3],
    [0, "r", 1], [1, "R", 0], [0, "a", 2], [0, "n", 3],
    [0, "x", null], [0, "Enter", null], [0, " ", null],
  ])("moves from %s with %s to %s", (current, key, expected) => {
    expect(pickerTarget(labels, current as number, key as string)).toBe(expected);
  });
  it("announces the current choice and the listbox disclosure", () => {
    const markup = renderToStaticMarkup(<PracticePicker label="Card order" value="newest" onChange={() => undefined}
      options={[{ value: "original", label: "Oldest first" }, { value: "newest", label: "Newest first" }]} />);
    expect(markup).toContain('aria-label="Card order: Newest first"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
  });
});
