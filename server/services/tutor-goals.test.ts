import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { firstTutorExerciseMessage } from "../../contracts/tutor-adaptation.js";
import { guidedPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";
import { createApiTestContext } from "../testing/api-test-context.js";
import { genericLearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { TutorService } from "./tutor.js";

it("counts saved replies once, excludes automatic starters, and credits a failed message only after retry succeeds", async () => {
  const context = createApiTestContext();
  const create = vi.fn().mockResolvedValue({ id: "response", output_text: "A short answer.", output: [] });
  const tutor = new TutorService(context.repository, { configured: true, learner: genericLearnerPersona } as OpenAIService,
    false, { responses: { create } } as unknown as OpenAI);
  try {
    context.repository.goals.start();
    const request = { language: "en" as const, message: "Tell me about your day.", clientMessageId: randomUUID() };
    const reply = await tutor.chat(request);
    await tutor.chat(request);
    expect(context.repository.goals.snapshot().today.counts.tutor).toBe(1);
    for (const message of [firstTutorExerciseMessage, guidedPracticeStartMessage]) {
      await tutor.chat({ language: "en", message, clientMessageId: randomUUID() });
    }
    expect(context.repository.goals.snapshot().today.counts.tutor).toBe(1);
    create.mockRejectedValueOnce(new Error("Provider failed"));
    const next = { ...request, threadPublicId: reply.threadId, message: "And tomorrow?", clientMessageId: randomUUID() };
    await expect(tutor.chat(next)).rejects.toThrow();
    expect(context.repository.goals.snapshot().today.counts.tutor).toBe(1);
    await tutor.chat(next);
    expect(context.repository.goals.snapshot().today.counts.tutor).toBe(2);
  } finally { vi.restoreAllMocks(); context.close(); }
});
