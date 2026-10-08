import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";
import { effectiveTutorSettings, initialTutorMode, reassessTutorMode } from "../../services/tutor-mode-config.js";
import type { TutorSessionSummary } from "../../../contracts/tutor-adaptation.js";

export const independentSummary: TutorSessionSummary = { meaningfulActivities: 1, answeredIndependently: true,
  understoodInstructionsWithoutExtraHelp: true, selectedDirectionIndependently: true, requiredExamplesFrequently: false,
  requiredNativeLanguageSupportFrequently: false, handledOpenQuestions: true, explicitlyRequestedMoreHelp: false, explicitlyRequestedLessHelp: false };
const assisted = { ...independentSummary, answeredIndependently: false, requiredExamplesFrequently: true };

describe("Tutor support selection", () => {
  it("chooses all three styles conservatively and defaults to intermediate", () => {
    for (const mode of ["beginner", "intermediate", "advanced"] as const) expect(initialTutorMode({ comfort: mode, preference: mode })).toBe(mode);
    expect(initialTutorMode({})).toBe("intermediate");
    expect(initialTutorMode({ comfort: "advanced", preference: "intermediate" })).toBe("intermediate");
    expect(initialTutorMode({ comfort: "advanced", preference: "beginner" })).toBe("beginner");
    expect(initialTutorMode({ comfort: "advanced", preference: "advanced", needsModel: true })).toBe("beginner");
    expect(initialTutorMode({ comfort: "advanced", preference: "advanced", sample: "Я живу в Риге. Хочу путешествовать." })).toBe("beginner");
    expect(initialTutorMode({ comfort: "advanced", preference: "advanced", sample: "I live in Riga. I want to travel." })).toBe("advanced");
    expect(reassessTutorMode([independentSummary]).decision).toBe("keep");
    expect(reassessTutorMode([independentSummary, independentSummary, assisted]).decision).toBe("keep");
    expect(reassessTutorMode([{ ...assisted, explicitlyRequestedMoreHelp: true }, { ...independentSummary, explicitlyRequestedLessHelp: true }, independentSummary]).decision).toBe("keep");
  });
});

describe("Tutor profiles and session lifecycle", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());
  it("resumes, retries completion without duplicate chats, and preserves existing learning data", () => {
    const before = context.db.prepare("SELECT * FROM items ORDER BY id").all();
    const a = context.repository.tutor.adaptation;
    a.start("en"); a.start("en");
    a.answer("en", "ru", 0, 1, {});
    a.answer("en", "ru", 1, 2, { comfort: "advanced" });
    a.answer("en", "ru", 1, 2, { comfort: "advanced" });
    expect(() => a.answer("en", "ru", 1, 2, { comfort: "beginner" })).toThrow("ONBOARDING_STEP_CHANGED");
    context.reopen();
    expect(context.repository.tutor.adaptation.get("en")?.onboardingStep).toBe(2);
    const skipped = context.repository.tutor.adaptation.complete("en", "ru", true);
    expect(skipped.interactionMode).toBe("intermediate");
    expect(context.repository.tutor.adaptation.complete("en", "ru", true)).toEqual(skipped);
    expect(context.repository.tutor.listThreads("en")).toHaveLength(1);
    expect(context.db.prepare("SELECT * FROM items ORDER BY id").all()).toEqual(before);
    expect(context.db.pragma("foreign_key_check")).toEqual([]);
    expect(context.repository.system.quickCheck()).toBe(true);
  });
  it("checks on 3, 13, 23 new sessions, moves one step, keeps old session settings and deduplicates", () => {
    const a = context.repository.tutor.adaptation;
    a.update("en", "ru", { mode: "beginner" });
    expect(a.sessionSettings("en", "old-session").answerSupport).toBe("full");
    for (let count = 1; count <= 23; count++) {
      const session = randomUUID();
      const profile = a.completeSession("en", session, independentSummary);
      a.completeSession("en", session, independentSummary);
      expect(profile.completedTutorSessions).toBe(count);
      expect(profile.nextReassessmentAtSession).toBe(count < 3 ? 3 : count < 13 ? 13 : count < 23 ? 23 : 33);
      if (count === 3) expect(profile.interactionMode).toBe("intermediate");
      if (count === 13) expect(profile.interactionMode).toBe("advanced");
    }
    expect(a.sessionSettings("en", "old-session").answerSupport).toBe("full");
    expect(a.sessionSettings("en", "new-session").answerSupport).toBe("on_request");
    a.completeSession("en", randomUUID(), { ...independentSummary, meaningfulActivities: 0 });
    expect(a.get("en")?.completedTutorSessions).toBe(23);
    expect(context.db.prepare("SELECT * FROM tutor_adaptation_events WHERE kind='tutor_mode_reassessment_completed'").all()).toHaveLength(3);
  });
  it("moves down, separates languages and overrides only selected fields", () => {
    const a = context.repository.tutor.adaptation;
    a.update("en", "ru", { mode: "advanced", overrides: { nativeLanguageUsage: "allowed" } });
    const settings = effectiveTutorSettings(a.get("en"));
    expect(settings.nativeLanguageUsage).toBe("allowed"); expect(settings.initiative).toBe("user");
    for (let i = 0; i < 3; i++) a.completeSession("en", randomUUID(), assisted);
    expect(a.get("en")?.interactionMode).toBe("intermediate");
    expect(a.ensure("lv").completedTutorSessions).toBe(0);
    expect(a.get("lv")?.customTutorSettings).toEqual({});
    a.update("en", "ru", { overrides: { answerSupport: "full" } });
    a.update("en", "ru", { removeOverrides: ["nativeLanguageUsage"] });
    expect(a.get("en")?.customTutorSettings).toEqual({ answerSupport: "full" });
    a.update("en", "ru", { resetOverrides: true });
    expect(a.get("en")?.customTutorSettings).toEqual({});
  });
  it("can turn off all adaptation and turn it back on without deleting profiles or history", () => {
    const a = context.repository.tutor.adaptation;
    a.complete("en", "ru", true);
    const before = a.get("en");
    a.setEnabled(false); expect(a.enabled()).toBe(false);
    context.reopen(); expect(context.repository.tutor.adaptation.enabled()).toBe(false);
    expect(context.repository.tutor.adaptation.get("en")).toEqual(before);
    context.repository.tutor.adaptation.setEnabled(true);
    expect(context.repository.tutor.adaptation.enabled()).toBe(true);
  });
});
