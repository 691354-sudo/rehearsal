import { describe, expect, it } from "vitest";
import { isKeyboardViewport } from "./useMobileKeyboard";

describe("mobile keyboard viewport", () => {
  it("recognizes a software keyboard without assuming a fixed keyboard height", () => {
    expect(isKeyboardViewport(720, 429, 1)).toBe(true);
    expect(isKeyboardViewport(844, 500, 1)).toBe(true);
  });
  it("ignores browser chrome, a hardware keyboard, and pinch zoom", () => {
    expect(isKeyboardViewport(720, 650, 1)).toBe(false);
    expect(isKeyboardViewport(720, 720, 1)).toBe(false);
    expect(isKeyboardViewport(720, 400, 1.8)).toBe(false);
  });
});
