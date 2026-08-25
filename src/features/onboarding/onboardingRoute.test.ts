import { describe, expect, it } from "vitest";
import {
  isWelcomeLocation,
  onboardingHref,
  parseOnboardingMode,
  parseOnboardingStep,
} from "./onboardingRoute";

describe("onboarding routes", () => {
  it("uses stable steps under the configured base", () => {
    expect(onboardingHref("notebook", "first_run", "/rehearsal"))
      .toBe("/rehearsal/welcome?step=notebook");
    expect(onboardingHref("library", "replay", "/rehearsal/"))
      .toBe("/rehearsal/welcome?step=library&mode=replay");
  });

  it("parses valid state and falls back safely", () => {
    expect(parseOnboardingStep({ search: "?step=tutor" })).toBe("tutor");
    expect(parseOnboardingStep({ search: "?step=unknown" })).toBe("intro");
    expect(parseOnboardingMode({ search: "?step=intro&mode=replay" })).toBe("replay");
    expect(parseOnboardingMode({ search: "" })).toBe("first_run");
  });

  it("recognizes only the dedicated welcome path", () => {
    expect(isWelcomeLocation({ pathname: "/rehearsal/welcome" }, "/rehearsal/")).toBe(true);
    expect(isWelcomeLocation({ pathname: "/rehearsal/practice/listen" }, "/rehearsal/")).toBe(false);
  });
});
