import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

const playback = { provider: "openai", repetitions: 3, speed: 0.85, playAfterRecall: false, voice: "onyx",
  elevenlabs: { voiceId: "test-voice", modelId: "eleven_multilingual_v2" } };
describe("Account audio and Tutor settings API", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());
  it("loads saved preferences in a second client, migrates once, merges concurrent fields and isolates languages", async () => {
    const app = await buildApp(context.repository);
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=en" })).json().playback).toBeNull();
    const put = (method: "POST" | "PATCH", values: object) => app.inject({ method, url: "/api/settings/playback", payload: { language: "en", playback: values } });
    expect((await put("POST", playback)).statusCode).toBe(200);
    expect((await put("POST", { ...playback, speed: 1 })).json().playback.speed).toBe(0.85);
    await Promise.all([put("PATCH", { speed: 1.1 }), put("PATCH", { repetitions: 5 }), put("PATCH", { elevenlabs: { voiceId: "another" } })]);
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=en" })).json().playback).toMatchObject({ speed: 1.1, repetitions: 5, playAfterRecall: false,
      elevenlabs: { voiceId: "another", modelId: "eleven_multilingual_v2" } });
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=lv" })).json().playback).toBeNull();
    expect((await put("PATCH", { speed: 10 })).statusCode).toBe(400);
    expect((await put("PATCH", { repetitions: 100 })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/settings/playback?language=vi" })).statusCode).toBe(403);
    await app.close(); context.reopen();
    const secondClient = await buildApp(context.repository);
    expect((await secondClient.inject({ method: "GET", url: "/api/settings/playback?language=en" })).json().playback.speed).toBe(1.1);
    await secondClient.close();
  });
  it("starts, resumes and skips onboarding idempotently while old chats remain usable and adaption can be disabled", async () => {
    const app = await buildApp(context.repository);
    const get = () => app.inject({ method: "GET", url: "/api/tutor/learning-profile?language=en" });
    expect((await get()).json()).toMatchObject({ enabled: true, profile: { onboardingStatus: "in_progress", interactionMode: "intermediate" } });
    const advance = await app.inject({ method: "POST", url: "/api/tutor/onboarding/answer", payload: { language: "en", expectedStep: 0, step: 1, answers: {} } });
    expect(advance.json().profile.onboardingStep).toBe(1);
    expect((await get()).json().profile.onboardingStep).toBe(1);
    const skip = () => app.inject({ method: "POST", url: "/api/tutor/onboarding/skip", payload: { language: "en" } });
    const first = (await skip()).json().profile;
    expect((await skip()).json().profile).toEqual(first);
    expect((await app.inject({ method: "GET", url: `/api/chat/${first.firstExerciseThreadId}/messages` })).json().messages).toHaveLength(1);
    context.repository.tutor.adaptation.setEnabled(false);
    expect((await get()).json().enabled).toBe(false);
    expect((await app.inject({ method: "PATCH", url: "/api/tutor/learning-profile", payload: { language: "en", mode: "advanced" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/chat/${first.firstExerciseThreadId}/finish` })).json().counted).toBe(false);
    expect((await app.inject({ method: "PATCH", url: "/api/tutor/learning-profile", payload: { language: "en", overrides: { answerSupport: "anything" } } })).statusCode).toBe(400);
    await app.close();
  });
});
