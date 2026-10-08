import { randomUUID } from "node:crypto";
import type { RehearsalDatabase } from "../database.js";
import type { LanguageCode } from "../../../contracts/api.js";
import { adaptationSummarySchema, firstTutorExerciseMessage, onboardingAnswersSchema, tutorModeSchema, tutorModes, tutorOverridesSchema,
  type OnboardingAnswers, type TutorLearningProfile, type TutorMode, type TutorModeConfig, type TutorSessionSummary } from "../../../contracts/tutor-adaptation.js";
import { effectiveTutorSettings, initialTutorMode, reassessTutorMode, TUTOR_CONFIG_VERSION } from "../../services/tutor-mode-config.js";
import { PilotError } from "../pilot/store.js";
import type { TutorRepository } from "./tutor.js";

export class TutorAdaptationRepository {
  constructor(private readonly db: RehearsalDatabase, private readonly tutor: Pick<TutorRepository, "getOrCreateThread" | "getOrCreateClientMessage">) {}

  enabled() {
    if (process.env.TUTOR_ADAPTATION_ENABLED === "false") return false;
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = 'tutor_adaptation_enabled'").get() as { value: string } | undefined;
    return row?.value !== "false";
  }

  setEnabled(enabled: boolean) {
    this.db.prepare("INSERT INTO app_settings(key, value) VALUES ('tutor_adaptation_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(enabled));
  }

  sessionSettings(language: LanguageCode, sessionId: string) {
    const profile = this.get(language);
    this.db.prepare("INSERT OR IGNORE INTO tutor_adaptation_thread_settings VALUES (?, ?)").run(sessionId, profile?.interactionMode || "intermediate");
    const row = this.db.prepare("SELECT interaction_mode FROM tutor_adaptation_thread_settings WHERE session_id = ?").get(sessionId) as { interaction_mode: TutorMode };
    return effectiveTutorSettings({ interactionMode: row.interaction_mode, customTutorSettings: profile?.customTutorSettings || {} });
  }

  setSessionMode(sessionId: string, mode: TutorMode) {
    this.db.prepare("INSERT INTO tutor_adaptation_thread_settings VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET interaction_mode = excluded.interaction_mode").run(sessionId, mode);
  }

  get(language: LanguageCode, native = "ru") {
    const row = this.db.prepare("SELECT profile FROM tutor_learning_profiles WHERE native_language = ? AND target_language = ?")
      .get(native, language) as { profile: string } | undefined;
    return row ? JSON.parse(row.profile) as TutorLearningProfile : null;
  }

  private save(profile: TutorLearningProfile) {
    profile.updatedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO tutor_learning_profiles VALUES (?, ?, ?)
      ON CONFLICT(native_language, target_language) DO UPDATE SET profile = excluded.profile`)
      .run(profile.nativeLanguage, profile.targetLanguage, JSON.stringify(profile));
    return profile;
  }

  ensure(language: LanguageCode, native = "ru") {
    const found = this.get(language, native);
    if (found) return found;
    const now = new Date().toISOString();
    return this.save({ nativeLanguage: native, targetLanguage: language, onboardingStatus: "not_started", onboardingStep: 0,
      answers: {}, interactionMode: "intermediate", customTutorSettings: {}, goals: [], interests: [], preferredTopics: [],
      completedTutorSessions: 0, lastReassessmentSessionCount: 0, nextReassessmentAtSession: 3, lastReassessmentAt: null,
      firstExerciseThreadId: null, firstExerciseMessageId: null, createdAt: now, updatedAt: now });
  }

  event(language: LanguageCode, kind: string, data: Record<string, unknown> = {}, native = "ru") {
    this.db.prepare("INSERT INTO tutor_adaptation_events(kind, native_language, target_language, data, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(kind, native, language, JSON.stringify({ ...data, config_version: TUTOR_CONFIG_VERSION }), new Date().toISOString());
  }

  start(language: LanguageCode, native = "ru") {
    return this.db.transaction(() => {
      const profile = this.ensure(language, native);
      if (profile.onboardingStatus === "not_started") {
        profile.onboardingStatus = "in_progress";
        profile.onboardingStartedAt = new Date().toISOString();
        this.event(language, "tutor_onboarding_started", {}, native);
        this.event(language, "tutor_funnel_viewed", {}, native);
        this.save(profile);
      }
      return profile;
    }).immediate();
  }

  answer(language: LanguageCode, native: string, expectedStep: number, step: number, answers: OnboardingAnswers) {
    return this.db.transaction(() => {
      const profile = this.ensure(language, native);
      if (["completed", "skipped"].includes(profile.onboardingStatus)) return profile;
      const parsed = onboardingAnswersSchema.parse(answers);
      if (profile.onboardingStep !== expectedStep) {
        if (profile.onboardingStep === step && Object.entries(parsed).every(([key, value]) => JSON.stringify(profile.answers[key as keyof OnboardingAnswers]) === JSON.stringify(value))) return profile;
        throw new PilotError("ONBOARDING_STEP_CHANGED");
      }
      if (step > expectedStep + 1 || step < 0 || step > 6) throw new PilotError("INVALID_ONBOARDING_STEP", 400);
      const fields = [[], [], ["comfort"], ["goals"], ["interests"], ["preference"], ["sample", "needsModel"]][step];
      if (step > expectedStep && step > 1 && fields.length && !fields.some((field) => field in parsed)) throw new PilotError("ONBOARDING_ANSWER_REQUIRED", 400);
      profile.answers = { ...profile.answers, ...parsed }; profile.onboardingStep = step;
      if (step === 6) profile.interactionMode = initialTutorMode(profile.answers);
      if (step > expectedStep && expectedStep > 0) this.event(language, "tutor_onboarding_answered", { step: expectedStep }, native);
      return this.save(profile);
    }).immediate();
  }

  complete(language: LanguageCode, native = "ru", skip = false) {
    return this.db.transaction(() => {
      const profile = this.ensure(language, native);
      if (["completed", "skipped"].includes(profile.onboardingStatus)) return profile;
      if (!skip && (profile.onboardingStep !== 6 || !profile.answers.comfort || !profile.answers.preference)) throw new PilotError("ONBOARDING_INCOMPLETE");
      profile.interactionMode = skip ? "intermediate" : initialTutorMode(profile.answers);
      profile.onboardingStatus = skip ? "skipped" : "completed";
      profile.goals = profile.answers.goals || []; profile.interests = profile.answers.interests ? [profile.answers.interests] : [];
      profile.preferredTopics = [...profile.interests];
      const thread = this.tutor.getOrCreateThread(undefined, language);
      profile.firstExerciseThreadId = thread.publicId;
      profile.firstExerciseMessageId = randomUUID();
      this.tutor.getOrCreateClientMessage({ language, threadPublicId: thread.publicId, clientMessageId: profile.firstExerciseMessageId,
        content: firstTutorExerciseMessage });
      this.event(language, skip ? "tutor_onboarding_skipped" : "tutor_onboarding_completed", {}, native);
      this.event(language, "tutor_initial_mode_selected", { from_mode: null, to_mode: profile.interactionMode, trigger: skip ? "skip" : "onboarding",
        reason_codes: [skip ? "user_skipped" : "initial_support_signals"], sessions_reviewed: 0 }, native);
      return this.save(profile);
    }).immediate();
  }

  update(language: LanguageCode, native: string, input: { mode?: TutorMode; overrides?: Partial<TutorModeConfig>; removeOverrides?: (keyof TutorModeConfig)[]; resetOverrides?: boolean; goals?: string[]; interests?: string[] }, trigger = "settings") {
    return this.db.transaction(() => {
      const profile = this.ensure(language, native);
      if (input.mode) {
        const mode = tutorModeSchema.parse(input.mode);
        if (mode !== profile.interactionMode) this.event(language, "tutor_mode_changed", { from_mode: profile.interactionMode, to_mode: mode, trigger,
          reason_codes: [trigger], sessions_reviewed: 0 }, native);
        profile.interactionMode = mode;
      }
      if (input.resetOverrides || input.removeOverrides?.length || Object.keys(input.overrides || {}).length) {
        profile.customTutorSettings = input.resetOverrides ? {} : { ...profile.customTutorSettings, ...tutorOverridesSchema.parse(input.overrides || {}) };
        for (const field of input.removeOverrides || []) delete profile.customTutorSettings[field];
        this.event(language, "tutor_user_override_changed", { trigger, fields: Object.keys(input.overrides || {}), reset: Boolean(input.resetOverrides) }, native);
      }
      if (input.goals) profile.goals = input.goals;
      if (input.interests) { profile.interests = input.interests; profile.preferredTopics = input.interests; }
      return this.save(profile);
    }).immediate();
  }

  completed(sessionId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM tutor_adaptation_sessions WHERE session_id = ?").get(sessionId));
  }

  markFirstExercise(language: LanguageCode, clientMessageId: string) {
    this.db.transaction(() => {
      const profile = this.get(language);
      if (!profile || profile.firstExerciseMessageId !== clientMessageId || profile.firstExerciseStartedAt) return;
      profile.firstExerciseStartedAt = new Date().toISOString();
      this.event(language, "tutor_first_exercise_started", { seconds_since_onboarding_start:
        Math.max(0, (Date.parse(profile.firstExerciseStartedAt) - Date.parse(profile.onboardingStartedAt || profile.createdAt)) / 1000) });
      this.save(profile);
    }).immediate();
  }

  completeSession(language: LanguageCode, sessionId: string, summary: TutorSessionSummary, native = "ru") {
    const validated = adaptationSummarySchema.parse(summary);
    return this.db.transaction(() => {
      const profile = this.ensure(language, native);
      if (this.completed(sessionId) || validated.meaningfulActivities === 0) return profile;
      const now = new Date().toISOString();
      profile.completedTutorSessions++;
      this.db.prepare("INSERT INTO tutor_adaptation_sessions VALUES (?, ?, ?, ?, ?, ?)")
        .run(sessionId, native, language, profile.completedTutorSessions, JSON.stringify(validated), now);
      this.event(language, "tutor_session_completed", { session_number: profile.completedTutorSessions }, native);
      if (sessionId === profile.firstExerciseThreadId && !profile.firstExerciseCompletedAt) {
        profile.firstExerciseCompletedAt = now;
        this.event(language, "tutor_first_exercise_completed", {}, native);
      }
      this.save(profile);
      if (profile.completedTutorSessions >= profile.nextReassessmentAtSession) return this.reassess(language, native);
      return profile;
    }).immediate();
  }

  reassess(language: LanguageCode, native = "ru") {
    const profile = this.ensure(language, native);
    if (profile.completedTutorSessions < profile.nextReassessmentAtSession) return profile;
    const rows = this.db.prepare(`SELECT summary FROM tutor_adaptation_sessions WHERE native_language = ? AND target_language = ?
      AND session_number > ? ORDER BY session_number`).all(native, language, profile.lastReassessmentSessionCount) as { summary: string }[];
    let decision: "keep" | "move_up" | "move_down" = "keep"; let reasons = ["invalid_summary"];
    try { const result = reassessTutorMode(rows.map((row) => adaptationSummarySchema.parse(JSON.parse(row.summary)))); decision = result.decision; reasons = [...result.reason_codes]; }
    catch { this.event(language, "tutor_reassessment_error", {}, native); }
    const from = profile.interactionMode;
    const index = Math.max(0, Math.min(2, tutorModes.indexOf(from) + (decision === "move_up" ? 1 : decision === "move_down" ? -1 : 0)));
    profile.interactionMode = tutorModes[index];
    const data = { from_mode: from, to_mode: profile.interactionMode, trigger: "reassessment", decision, reason_codes: reasons,
      sessions_reviewed: rows.length };
    this.event(language, "tutor_mode_reassessment_completed", data, native);
    this.event(language, from === profile.interactionMode ? "tutor_mode_kept" : "tutor_mode_changed", data, native);
    profile.lastReassessmentSessionCount = profile.completedTutorSessions; profile.nextReassessmentAtSession = profile.completedTutorSessions + 10;
    profile.lastReassessmentAt = new Date().toISOString();
    return this.save(profile);
  }
}
