import { describe, expect, it } from "vitest";
import { pwaPathPatterns } from "./pwa-paths";

describe("PWA path patterns", () => {
  it("keeps the recovery navigation on the network", () => {
    const { privatePathPattern, recoveryPathPattern } = pwaPathPatterns("/rehearsal/");
    expect(recoveryPathPattern.test("/rehearsal/recover")).toBe(true);
    expect(recoveryPathPattern.test("/rehearsal/tutor/chat")).toBe(false);
    expect(privatePathPattern.test("/rehearsal/api/items")).toBe(true);
  });

  it("supports a root deployment", () => {
    const { recoveryPathPattern } = pwaPathPatterns("/");
    expect(recoveryPathPattern.test("/recover")).toBe(true);
    expect(recoveryPathPattern.test("/rehearsal/recover")).toBe(false);
  });
});
