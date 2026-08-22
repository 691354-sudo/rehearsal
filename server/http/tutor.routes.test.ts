import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";
import { reviewCandidate } from "../testing/candidates.js";

const multipartAudio = (boundary: string, mime: string, audio: Buffer) => Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="message.bin"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`,
  ),
  audio,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

describe("Tutor and review API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("remains a usable setup guide before an OpenAI key is configured", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(context.repository, { openai });
    const clientMessageId = "18bbd3da-6538-4f2d-b501-91a934b0bf61";
    const response = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { language: "en", message: "Help me practice small talk", threadId: null, clientMessageId },
    });
    expect(response.json()).toMatchObject({ mode: "setup" });
    const threadId = response.json().threadId as string;
    const threads = await app.inject({ method: "GET", url: "/api/chat/threads?language=en" });
    expect(threads.json().threads).toEqual([
      expect.objectContaining({ publicId: threadId, title: "Help me practice small talk", messageCount: 2 }),
    ]);
    const retried = await app.inject({
      method: "POST",
      url: "/api/chat",
      payload: { language: "en", message: "Help me practice small talk", threadId: null, clientMessageId },
    });
    expect(retried.json()).toMatchObject({ threadId, content: response.json().content, mode: "setup" });
    const history = await app.inject({ method: "GET", url: `/api/chat/${threadId}/messages` });
    expect(history.json().messages).toHaveLength(2);
    expect(history.json().messages[0]).toEqual({ role: "user", content: "Help me practice small talk" });
    expect((await app.inject({ method: "DELETE", url: `/api/chat/${threadId}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/chat/threads?language=en" })).json().threads).toEqual([]);
    await app.close();
  });

  it("requires an idempotency key and rejects reusing it for different content", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(context.repository, { openai });
    const missing = await app.inject({
      method: "POST", url: "/api/chat", payload: { language: "en", message: "First" },
    });
    expect(missing.statusCode).toBe(400);

    const clientMessageId = "bbf405bf-a111-4431-89c8-c983b1954343";
    expect((await app.inject({
      method: "POST", url: "/api/chat",
      payload: { language: "en", message: "First", clientMessageId },
    })).statusCode).toBe(200);
    const conflict = await app.inject({
      method: "POST", url: "/api/chat",
      payload: { language: "en", message: "Changed", clientMessageId },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: "CLIENT_MESSAGE_ID_CONFLICT" });
    await app.close();
  });

  it("reuses one Tutor result for parallel requests with the same client message id", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(context.repository, { openai });
    const payload = {
      language: "en",
      message: "Practise this once",
      clientMessageId: "f5d5b77a-7f52-41bb-9800-09693c0cb5c5",
    };
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/api/chat", payload }),
      app.inject({ method: "POST", url: "/api/chat", payload }),
    ]);
    expect(second.json()).toMatchObject({ threadId: first.json().threadId, content: first.json().content });
    expect(context.repository.tutor.listThreads("en", 50)[0]).toMatchObject({ messageCount: 2 });
    await app.close();
  });

  it("does not duplicate a vocabulary source or review batch when a send is retried", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    const app = await buildApp(context.repository, { openai });
    const beforeSources = (context.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number }).count;
    const beforeBatches = (context.db.prepare("SELECT COUNT(*) AS count FROM review_batches").get() as { count: number }).count;
    const payload = {
      language: "en",
      title: "Vocabulary from Tutor",
      text: "pull through\nbounce back\nfigure out\nturn down\nlook into",
      clientMessageId: "d81acc22-ae19-43c4-b84f-a4523e620da7",
    };

    const first = await app.inject({ method: "POST", url: "/api/review-batches/vocab", payload });
    const retried = await app.inject({ method: "POST", url: "/api/review-batches/vocab", payload });

    expect(retried.json()).toMatchObject({
      threadId: first.json().threadId,
      content: first.json().content,
      batch: { publicId: first.json().batch.publicId },
    });
    expect((context.db.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number }).count)
      .toBe(beforeSources + 1);
    expect((context.db.prepare("SELECT COUNT(*) AS count FROM review_batches").get() as { count: number }).count)
      .toBe(beforeBatches + 1);
    expect(context.repository.tutor.listThreads("en", 50)[0]).toMatchObject({ messageCount: 2 });
    await app.close();
  });

  it("transcribes a voice message without saving the audio or creating a chat", async () => {
    const openai = new OpenAIService(context.repository);
    const transcribe = vi.spyOn(openai, "transcribe").mockResolvedValue("Can we practise a job interview?");
    const app = await buildApp(context.repository, { openai });
    const boundary = "----rehearsal-tutor-voice";
    const response = await app.inject({
      method: "POST",
      url: "/api/chat/transcribe?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartAudio(boundary, "audio/webm", Buffer.from("fake-webm-audio")),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transcript: "Can we practise a job interview?" });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audioMime: "audio/webm",
      filename: "tutor-message.webm",
      languages: ["en", "ru"],
    }));
    expect(context.repository.tutor.listThreads("en", 50)).toEqual([]);
    await app.close();
  });

  it("keeps generated proposals out of Library until selected cards are committed", async () => {
    const before = context.repository.items.list("en", 500).length;
    const candidate = reviewCandidate({
      target: "I tend to bounce back pretty quickly.",
      cue: "Я обычно довольно быстро прихожу в себя.",
      category: "resilience",
      focusTerms: ["bounce back"],
    });
    const batch = context.repository.reviews.create({
      language: "en",
      kind: "vocab",
      title: "Vocab test",
      candidates: [candidate],
    });
    expect(context.repository.items.list("en", 500)).toHaveLength(before);

    const app = await buildApp(context.repository);
    const response = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batch.publicId}/commit`,
      payload: { candidates: [{
        id: candidate.id,
        target: candidate.target,
        cue: candidate.cue,
        note: candidate.note,
        category: candidate.category,
      }] },
    });
    expect(response.json().added).toBe(1);
    expect(context.repository.items.list("en", 500)).toHaveLength(before + 1);
    expect(context.repository.items.list("en", 500).find((item) => item.target === candidate.target))
      .toMatchObject({ frequencyBand: "common", currency: "current", focusTerms: ["bounce back"] });
    await app.close();
  });

  it("adds approved Tutor corrections while revising individually commented cards", async () => {
    const approved = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb561",
      target: "I agree with this idea.",
      cue: "Я согласен с этой идеей.",
      category: "conversation",
    });
    const commented = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb562",
      target: "It depends from the situation.",
      cue: "Это зависит от ситуации.",
      category: "conversation",
    });
    const batch = context.repository.reviews.create({
      language: "en",
      kind: "chat_review",
      title: "Tutor conversation review",
      candidates: [approved, commented],
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "resolveReview").mockImplementation(async ({ batchPublicId, accepted, revisions }) => {
      const current = context.repository.reviews.get(batchPublicId)!;
      const revised = revisions.map((revision) => ({
        ...current.candidates.find((candidate) => candidate.id === revision.id)!,
        target: "It depends on the situation.",
      }));
      return context.repository.reviews.resolveRevision(batchPublicId, accepted, revised);
    });
    const app = await buildApp(context.repository, { openai });

    const response = await app.inject({
      method: "POST",
      url: `/api/review-batches/${batch.publicId}/resolve`,
      payload: {
        accepted: [{
          id: approved.id,
          target: approved.target,
          cue: approved.cue,
          note: approved.note,
          category: approved.category,
        }],
        revisions: [{
          id: commented.id,
          target: commented.target,
          cue: commented.cue,
          note: commented.note,
          category: commented.category,
          feedback: "Исправь предлог, но сохрани смысл.",
        }],
      },
    });

    expect(response.json()).toMatchObject({ added: 1, batch: { status: "draft" } });
    expect(response.json().batch.candidates).toEqual([
      expect.objectContaining({ id: commented.id, target: "It depends on the situation." }),
    ]);
    expect(context.repository.items.list("en", 500)).toContainEqual(
      expect.objectContaining({ target: approved.target, kind: "correction" }),
    );
    await app.close();
  });

  it("commits only the selected pattern-drill variants", async () => {
    const before = context.repository.items.list("en", 500).length;
    const first = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb521",
      target: "I've always been drawn to quiet coastal towns.",
      cue: "Меня всегда тянуло к тихим приморским городам.",
      category: "travel",
      focusTerms: ["be drawn to"],
    });
    const second = reviewCandidate({
      id: "9ad9bdcb-8309-43cd-8e75-92ed741bb522",
      target: "I've always been drawn to people who speak their mind.",
      cue: "Меня всегда тянуло к людям, которые говорят прямо.",
      category: "relationships",
      focusTerms: ["be drawn to"],
    });
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "generatePatternDrill").mockImplementation(async ({ language }) => ({
      mode: "openai" as const,
      batch: context.repository.reviews.create({
        language,
        kind: "pattern_drill",
        title: "Pattern: I've always been drawn to…",
        candidates: [first, second],
      }),
    }));
    const app = await buildApp(context.repository, { openai });
    const prepared = await app.inject({ method: "POST", url: "/api/items/en-drawn-to/pattern-drill" });
    expect(prepared.statusCode).toBe(201);
    expect(context.repository.items.list("en", 500)).toHaveLength(before);

    const selected = prepared.json().batch.candidates[1];
    expect((await app.inject({
      method: "POST",
      url: `/api/review-batches/${prepared.json().batch.publicId}/commit`,
      payload: { candidates: [{
        id: selected.id,
        target: selected.target,
        cue: selected.cue,
        note: selected.note,
        category: selected.category,
      }] },
    })).json().added).toBe(1);
    const after = context.repository.items.list("en", 500);
    expect(after).toHaveLength(before + 1);
    expect(after.some((item) => item.target === first.target)).toBe(false);
    expect(after.find((item) => item.target === second.target)?.tags).toEqual(["be drawn to"]);
    await app.close();
  });
});
