import { describe, expect, it } from "vitest";
import {
  isOnboardingLocation,
  isWelcomeLocation,
  onboardingHref,
  parseOnboardingMode,
  parseOnboardingStep,
} from "./onboardingRoute";

describe("onboarding routes", () => {
  it("uses the real workspaces under the configured base", () => {
    expect(onboardingHref(
      "tutor", "en", "replay", "/rehearsal", "10000000-0000-4000-8000-000000000001",
    )).toBe("/rehearsal/tutor?lang=en&tour=replay&thread=10000000-0000-4000-8000-000000000001");
    expect(onboardingHref("notebook", "en", "first_run", "/rehearsal"))
      .toBe("/rehearsal/tutor/notebook?lang=en&tour=first_run");
    expect(onboardingHref("library", "lv", "replay", "/rehearsal/"))
      .toBe("/rehearsal/library?lang=lv&tour=replay");
  });

  it("parses valid state and falls back safely", () => {
    expect(parseOnboardingStep({ pathname: "/rehearsal/tutor", search: "?lang=en&tour=first_run" }, "/rehearsal/"))
      .toBe("tutor");
    expect(parseOnboardingStep({ pathname: "/rehearsal/tutor/notebook", search: "?lang=en&tour=first_run" }, "/rehearsal/"))
      .toBe("notebook");
    expect(parseOnboardingStep({ pathname: "/rehearsal/welcome", search: "?step=unknown" }, "/rehearsal/"))
      .toBe("tutor");
    expect(parseOnboardingMode({ search: "?step=intro&mode=replay" })).toBe("replay");
    expect(parseOnboardingMode({ search: "?tour=replay" })).toBe("replay");
    expect(parseOnboardingMode({ search: "" })).toBe("first_run");
  });

  it("recognizes legacy welcome and live replay routes", () => {
    expect(isWelcomeLocation({ pathname: "/rehearsal/welcome" }, "/rehearsal/")).toBe(true);
    expect(isWelcomeLocation({ pathname: "/rehearsal/practice/listen" }, "/rehearsal/")).toBe(false);
    expect(isOnboardingLocation({ pathname: "/rehearsal/library", search: "?lang=en&tour=replay" }, "/rehearsal/"))
      .toBe(true);
    expect(isOnboardingLocation({ pathname: "/rehearsal/library", search: "?lang=en" }, "/rehearsal/"))
      .toBe(false);
  });
});
