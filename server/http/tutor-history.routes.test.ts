import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

describe("Tutor history presentation and names", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());
  it("uses saved practice topics, searches no other language, and preserves a custom name", async () => {
    const repo = context.repository.tutor;
    const thread = repo.getOrCreateThread(undefined, "en");
    repo.ensureThreadTitle(thread.id, "Let's have a short lesson based on my cards");
    repo.addMessage(thread.id, "user", "Let's have a short lesson based on my cards", {
      contextPractice: { version: 1, selectedTargetIds: ["a", "b"], pool: [
        { id: "a", topic: "Travel", core: "be better off" }, { id: "b", topic: "Travel", core: "seem comfortable" },
        { id: "c", topic: "Unselected", core: "not practised" },
      ] },
    });
    const app = await buildApp(context.repository);
    const list = () => app.inject({ method: "GET", url: "/api/chat/threads?language=en" });
    expect((await list()).json().threads[0]).toMatchObject({ displayTitle: "Travel", practicePhrases: ["be better off", "seem comfortable"] });
    expect((await app.inject({ method: "GET", url: "/api/chat/threads?language=lv" })).json().threads).toEqual([]);
    const before = repo.getThread(thread.publicId)!;
    const rename = await app.inject({ method: "PATCH", url: `/api/chat/${thread.publicId}`, payload: { title: "  My trip  " } });
    expect(rename.statusCode).toBe(200);
    expect((await list()).json().threads[0]).toMatchObject({ title: "My trip", displayTitle: "My trip", messageCount: 1 });
    expect(repo.getThread(thread.publicId)!.updated_at).toBe(before.updated_at);
    expect(repo.getMessages(thread.id)[0].content).toBe("Let's have a short lesson based on my cards");
    await app.close();
  });
  it("rejects empty/long names and missing threads without changing the conversation", async () => {
    const repo = context.repository.tutor;
    const thread = repo.getOrCreateThread(undefined, "en");
    const app = await buildApp(context.repository);
    for (const title of [" ", "x".repeat(121)]) expect((await app.inject({ method: "PATCH", url: `/api/chat/${thread.publicId}`, payload: { title } })).statusCode).toBe(400);
    expect(repo.getThread(thread.publicId)!.title).toBe("Tutor chat");
    expect((await app.inject({ method: "PATCH", url: "/api/chat/00000000-0000-4000-8000-000000000001", payload: { title: "Missing" } })).statusCode).toBe(404);
    await app.close();
  });
  it("gives legacy generic starts a quiet fallback while keeping specific titles", () => {
    const repo = context.repository.tutor;
    for (const message of ["Let's have a practice", "Can I say that my colleague is reliable?"]) {
      const thread = repo.getOrCreateThread(undefined, "en"); repo.ensureThreadTitle(thread.id, message); repo.addMessage(thread.id, "user", message);
    }
    const rows = repo.listThreads("en");
    expect(rows.find((row) => row.title.startsWith("Let's"))).toMatchObject({ displayTitle: "Practice", practicePhrases: [] });
    expect(rows.find((row) => row.title.startsWith("Can I"))?.displayTitle).toContain("Can I say");
  });
});
