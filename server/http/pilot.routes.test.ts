import { readyTutorCard } from "../testing/pilot-requests.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("Pilot answer and Homework API", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); readyTutorCard(context); });
  afterEach(() => { vi.restoreAllMocks(); context.close(); });
  it("checks an existing English attempt against its own card without grading or touching FSRS", async () => {
    const repo = context.repository, now = new Date().toISOString();
    const topic = repo.library.createIsland({ language: "en", title: "API check" });
    const card = repo.items.create({ language: "en", cue: "Мне это нравится", target: "I like it." }, topic.publicId);
    repo.pilot.listening.toRecall({ eventId: randomUUID(), language: "en", cardId: card.publicId });
    const attemptId = randomUUID();
    repo.pilot.recall.begin({ attemptId, cardId: card.publicId, shownAt: now, timezone: "Europe/Riga" });
    const openai = new OpenAIService(repo);
    const check = vi.spyOn(openai, "checkRecall").mockResolvedValue({ verdict: "correct", explanationRu: "Верно", correctedAnswer: "I like it.", mistakes: [] });
    const app = await buildApp(repo, { openai });
    try {
      expect((await app.inject({ method: "POST", url: "/api/pilot/attempts/check", payload: { attemptId, answer: card.target, target: "forged" } })).json().check.verdict).toBe("correct");
      expect(check).toHaveBeenCalledWith(expect.objectContaining({ publicId: card.publicId, target: card.target }), card.target, attemptId);
      expect(repo.pilot.recall.get(attemptId)?.rated_at).toBeNull();
      expect(repo.pilot.store.review(card.publicId)).toBeNull();
      for (const payload of [{ attemptId: randomUUID(), answer: "Hi" }, { attemptId, answer: " " }, { attemptId, answer: "x".repeat(4001) }, { attemptId, answer: "Hi", language: "lv" }]) {
        const response = await app.inject({ method: "POST", url: "/api/pilot/attempts/check", payload });
        expect([400, 404]).toContain(response.statusCode);
      }
      expect(check).toHaveBeenCalledTimes(1);
      check.mockRejectedValueOnce(new Error("provider unavailable"));
      expect((await app.inject({ method: "POST", url: "/api/pilot/attempts/check", payload: { attemptId, answer: "Hi" } })).statusCode).toBe(503);
    } finally { await app.close(); }
  });
  it("reports incomplete and completed Tutor intros from server history and lists Homework without messages", async () => {
    const repo = context.repository;
    const hw = repo.pilot.homework.create({ homeworkId: randomUUID(), requestedMinutes: 1, timezone: "Europe/Riga" });
    const app = await buildApp(repo);
    try {
      const list = await app.inject({ method: "GET", url: "/api/pilot/homework?language=en" });
      expect(list.json().sessions).toEqual([expect.objectContaining({ homeworkId: hw.homeworkId, tutorChatId: hw.tutorChatId, title: expect.stringMatching(/^\d{2}\.\d{2}\.\d{4} - Homework$/) })]);
      const thread = repo.tutor.getThread(hw.tutorChatId)!;
      repo.tutor.addMessage(thread.id, "user", "Давай начнём homework.", {}, hw.homeworkId);
      const url = `/api/pilot?language=en&tutorChatId=${hw.tutorChatId}`;
      expect((await app.inject({ method: "GET", url })).json().tutorStarted).toBe(false);
      const history = (await app.inject({ method: "GET", url: `/api/chat/${hw.tutorChatId}/messages` })).json();
      expect(history.messages[0].clientMessageId).toBe(hw.homeworkId);
      repo.tutor.addMessage(thread.id, "assistant", "Начинаем", { clientMessageId: hw.homeworkId });
      expect((await app.inject({ method: "GET", url })).json().tutorStarted).toBe(true);
      repo.pilot.homework.deleteChat(hw.tutorChatId);
      expect((await app.inject({ method: "GET", url: "/api/pilot/homework?language=en" })).json().sessions).toEqual([]);
    } finally { await app.close(); }
  });
  it("runs written Recall and Tutor in Latvian even when English is disabled", async () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "lv", title: "Latvian flow" });
    const card = repo.items.create({ language: "lv", cue: "Спасибо", target: "Paldies." }, topic.publicId);
    context.db.prepare("UPDATE languages SET enabled=0 WHERE code='en'").run();
    const app = await buildApp(repo);
    try {
      const sessionId = randomUUID();
      const selected = await app.inject({ method: "POST", url: "/api/pilot/sessions", payload: { sessionId, language: "lv", limit: 10, topicId: topic.publicId } });
      expect(selected.json().items.map((item: {publicId:string}) => item.publicId)).toEqual([card.publicId]);
      const attemptId = randomUUID(), now = new Date().toISOString();
      expect((await app.inject({ method: "POST", url: "/api/pilot/attempts/start", payload: { sessionId, attemptId, language: "lv", cardId: card.publicId, shownAt: now, timezone: "UTC" } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/api/pilot/attempts/grade", payload: { attemptId, language: "lv", rating: "easy", revealedAt: now, ratedAt: now, responseTimeMs: 0, inputMode: "oral_self_check", answer: "" } })).statusCode).toBe(200);
      const created = await app.inject({ method: "POST", url: "/api/pilot/homework", payload: { homeworkId: randomUUID(), language: "lv", requestedMinutes: 2, timezone: "UTC" } });
      expect(created.statusCode).toBe(200);
      expect(created.json().homework).toMatchObject({ language: "lv", status: "tutor_in_progress", plannedTutorCardIds: [card.publicId] });
      expect((await app.inject({ method: "GET", url: "/api/pilot/homework?language=lv" })).json().sessions).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/api/pilot/liked?language=lv" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/pilot/queue?language=en" })).statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("keeps a direct Recall request scoped to its card before applying the session limit", async () => {
    const repo = context.repository;
    const topic = repo.library.createIsland({ language: "lv", title: "Direct Recall" });
    const cards = Array.from({length: 25}, () => repo.items.create({ language: "lv", cue: "Спасибо", target: "Paldies." }, topic.publicId));
    const cardId = cards.at(-1)!.publicId;
    const app = await buildApp(repo);
    try {
      const query = new URLSearchParams({language:"lv",limit:"10",cardId});
      const preview = await app.inject({ method:"GET", url:`/api/pilot/queue?${query}` });
      expect(preview.json().items.map((item:{publicId:string}) => item.publicId)).toEqual([cardId]);
      const selected = await app.inject({ method:"POST",url:"/api/pilot/sessions",payload:{sessionId:randomUUID(),language:"lv",limit:10,cardId} });
      expect(selected.json().items.map((item:{publicId:string}) => item.publicId)).toEqual([cardId]);
    } finally { await app.close(); }
  });

});
