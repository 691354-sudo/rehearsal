import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { genericLearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { TutorService } from "./tutor.js";
import { executeTutorControl } from "./tutor-controls.js";
import { guidedPracticeExercises } from "../../contracts/tutor-guided-practice.js";

describe("Tutor mode transitions and learning focus tools", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); vi.spyOn(console, "info").mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  const functionCall = (name: string, args: unknown) => ({ id: "tool", output_text: "", output: [
    { type: "function_call", name, arguments: JSON.stringify(args), call_id: randomUUID() },
  ] });
  const response = { id: "answer", output_text: "Let's talk about your day.", output: [] };
  const service = (create: ReturnType<typeof vi.fn>, reviewConversation = vi.fn().mockResolvedValue({ batch: { candidates: [] } })) =>
    new TutorService(context.repository, { configured: true, learner: genericLearnerPersona, reviewConversation } as unknown as OpenAIService,
      false, { responses: { create } } as unknown as OpenAI);

  it.each(guidedPracticeExercises)("starts $id only when explicitly selected", async (exercise) => {
    const create = vi.fn().mockResolvedValue(response);
    const reply = await service(create).chat({ language: "en", message: exercise.message, clientMessageId: randomUUID() });
    expect(create.mock.lastCall![0].instructions).toContain("Current mode: learner-requested guided practice");
    expect(context.repository.tutor.getMode(context.repository.tutor.getThread(reply.threadId)!.id)?.mode).toBe("guided");
    expect(create.mock.lastCall![0].text).toBeUndefined();
  });

  it("switches a guided conversation to free chat in the same response and restores ordinary review limits", async () => {
    const create = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(functionCall("set_tutor_mode", { mode: "chat" }))
      .mockResolvedValue(response);
    const reviewConversation = vi.fn().mockResolvedValue({ batch: { candidates: [] } });
    const tutor = service(create, reviewConversation);
    const first = await tutor.chat({ language: "en", message: guidedPracticeExercises[0].message, clientMessageId: randomUUID() });
    await tutor.chat({ language: "en", message: "Stop the exercise, let's just talk about life.", threadPublicId: first.threadId, clientMessageId: randomUUID() });
    expect(create.mock.lastCall![0].instructions).toContain("Current mode: ordinary Tutor chat");
    await tutor.review(first.threadId);
    expect(reviewConversation.mock.lastCall![0]).toMatchObject({ guidedPractice: false });
    expect(reviewConversation.mock.lastCall![0].messages).toHaveLength(4);
    context.reopen();
    expect(context.repository.tutor.getMode(context.repository.tutor.getThread(first.threadId)!.id)?.mode).toBe("chat");
  });

  it("accepts natural-language exercise starts and scopes review to that exercise", async () => {
    const create = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce(functionCall("set_tutor_mode", { mode: "guided" }))
      .mockResolvedValue(response);
    const reviewConversation = vi.fn().mockResolvedValue({ batch: { candidates: [] } });
    const tutor = service(create, reviewConversation);
    const first = await tutor.chat({ language: "en", message: "Let's chat.", clientMessageId: randomUUID() });
    await tutor.chat({ language: "en", message: "Теперь сделаем упражнение на пересказ моего текста.", threadPublicId: first.threadId, clientMessageId: randomUUID() });
    await tutor.review(first.threadId);
    expect(reviewConversation.mock.lastCall![0]).toMatchObject({ guidedPractice: true });
    expect(reviewConversation.mock.lastCall![0].messages).toHaveLength(2);
    expect(create.mock.lastCall![0].instructions).toContain("Current mode: learner-requested guided practice");
  });

  it("records grounded learner evidence and supplies it to the next provider round", async () => {
    const observation = { key: "past-simple", title: "Past simple", detail: "Use past forms for yesterday.", quotes: ["Yesterday I go home."] };
    const create = vi.fn().mockResolvedValueOnce(functionCall("record_learning_focus", { observations: [observation] })).mockResolvedValue(response);
    await service(create).chat({ language: "en", message: observation.quotes[0], clientMessageId: randomUUID() });
    expect(context.repository.tutor.learningFocus.list("en", true)).toHaveLength(1);
    expect(context.repository.tutor.learningFocus.list("en")).toEqual([]);
    expect(create.mock.lastCall![0].instructions).toContain('"occurrences":1');
    expect(create.mock.lastCall![0].instructions).toContain("One observed message is a candidate, not a recurring error");
  });
  it("can save a recurring topic during recap but cannot import evidence from another chat or a later message", () => {
    const tutor = context.repository.tutor;
    const thread = tutor.getOrCreateThread(undefined, "en");
    const observations = ["Yesterday I go home.", "Last week I go to a cafe."].map((quote) => {
      tutor.addMessage(thread.id, "user", quote);
      return { key: "past-simple", title: "Past simple", detail: "Use past forms.", quotes: [quote] };
    });
    const recap = tutor.addMessage(thread.id, "user", "Please give me a recap.");
    const toolContext = { language: "en" as const, threadId: thread.id, userMessageId: recap, homework: false };
    executeTutorControl(tutor, "record_learning_focus", { observations }, toolContext);
    expect(tutor.learningFocus.list("en")[0].occurrences).toBe(2);
    const other = tutor.getOrCreateThread(undefined, "en");
    tutor.addMessage(other.id, "user", "I seen him before.");
    tutor.addMessage(thread.id, "user", "I seen her before.");
    for (const quote of ["I seen him before.", "I seen her before."]) {
      expect(executeTutorControl(tutor, "record_learning_focus", { observations: [{ ...observations[0], quotes: [quote] }] }, toolContext))
        .toEqual([expect.objectContaining({ error: expect.any(String) })]);
    }
    expect(tutor.learningFocus.list("en")[0].occurrences).toBe(2);
  });

  it("keeps the exercise start on a redundant mode call and resets it for a new explicit selection", () => {
    const tutor = context.repository.tutor;
    const thread = tutor.getOrCreateThread(undefined, "en");
    const first = tutor.addMessage(thread.id, "user", guidedPracticeExercises[0].message);
    tutor.setMode(thread.id, first, "guided", true);
    const later = tutor.addMessage(thread.id, "user", "A grammar side question.");
    tutor.setMode(thread.id, later, "guided");
    expect(tutor.getMode(thread.id)?.messageId).toBe(first);
    tutor.setMode(thread.id, later, "guided", true);
    expect(tutor.getMode(thread.id)?.messageId).toBe(later);
  });

  it("keeps Homework's mode immutable and learning-focus management language-scoped", () => {
    const thread = context.repository.tutor.getOrCreateThread(undefined, "en");
    const id = context.repository.tutor.addMessage(thread.id, "user", "I goes home.");
    const toolContext = { language: "en" as const, threadId: thread.id, userMessageId: id, homework: true };
    expect(executeTutorControl(context.repository.tutor, "set_tutor_mode", { mode: "chat" }, toolContext)).toHaveProperty("error");
    expect(context.repository.tutor.getMode(thread.id)).toBeUndefined();
    expect(executeTutorControl(context.repository.tutor, "record_learning_focus", { observations: [] }, toolContext)).toHaveProperty("error");
    expect(executeTutorControl(context.repository.tutor, "list_learning_focus", {}, toolContext)).toEqual([]);
    expect(executeTutorControl(context.repository.tutor, "delete_learning_focus", { key: "missing" }, toolContext)).toEqual({ removed: false });
  });
});
