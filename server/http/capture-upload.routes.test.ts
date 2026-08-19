import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { OpenAIService } from "../services/openai.js";
import { createApiTestContext, type ApiTestContext } from "../testing/api-test-context.js";

const multipartAudio = (boundary: string, mime: string, audio: Buffer) => Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.bin"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`,
  ),
  audio,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);

describe("Capture uploads API", () => {
  let context: ApiTestContext;

  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => { context.close(); });

  it("transcribes a Russian voice note and clears its server-side audio", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Я хочу спокойно объяснить свою позицию.");
    const app = await buildApp(context.repository, { openai });
    const boundary = "----rehearsal-capture-test";
    const response = await app.inject({
      method: "POST",
      url: "/api/captures?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartAudio(boundary, "audio/webm", Buffer.from("fake-webm-audio")),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().note).toMatchObject({
      language: "en",
      transcript: "Я хочу спокойно объяснить свою позицию.",
      status: "ready",
    });
    expect(context.repository.capture.getAudio(response.json().note.publicId)?.audio).toBeNull();
    await app.close();
  });

  it("retains failed audio for Retry and clears it after success", async () => {
    const openai = new OpenAIService(context.repository);
    const transcribe = vi.spyOn(openai, "transcribe")
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce("Повторная расшифровка сработала.");
    const app = await buildApp(context.repository, { openai });
    const boundary = "----rehearsal-capture-retry";
    const response = await app.inject({
      method: "POST",
      url: "/api/captures?language=en",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartAudio(boundary, "audio/mp4", Buffer.from("fake-m4a-audio")),
    });
    expect(response.json().note.status).toBe("failed");
    const noteId = response.json().note.publicId as string;
    expect(context.repository.capture.getAudio(noteId)?.audio?.byteLength).toBeGreaterThan(0);

    const retry = await app.inject({ method: "POST", url: `/api/captures/${noteId}/retry` });
    expect(retry.json().note).toMatchObject({
      status: "ready",
      transcript: "Повторная расшифровка сработала.",
    });
    expect(context.repository.capture.getAudio(noteId)?.audio).toBeNull();
    expect(transcribe).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it("creates, edits, and deletes text notes without transcription", async () => {
    const openai = new OpenAIService(context.repository);
    const transcribe = vi.spyOn(openai, "transcribe");
    const app = await buildApp(context.repository, { openai });
    const created = await app.inject({
      method: "POST",
      url: "/api/captures/text",
      payload: { language: "lv", transcript: "  Я хочу говорить точнее.  " },
    });
    expect(created.json().note).toMatchObject({
      language: "lv",
      transcript: "Я хочу говорить точнее.",
      status: "ready",
      audioMime: "",
    });
    const noteId = created.json().note.publicId as string;
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/captures/${noteId}`,
      payload: { transcript: "Я хочу говорить по-латышски точнее." },
    });
    expect(edited.json().note.transcript).toBe("Я хочу говорить по-латышски точнее.");
    expect((await app.inject({ method: "DELETE", url: `/api/captures/${noteId}` })).statusCode).toBe(204);
    expect(context.repository.capture.get(noteId)).toBeNull();
    expect(transcribe).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects empty, unsupported, and oversized capture uploads", async () => {
    const openai = new OpenAIService(context.repository);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Не должно вызываться.");
    const app = await buildApp(context.repository, { openai });
    const request = (mime: string, audio: Buffer) => {
      const boundary = `----capture-validation-${mime.replace(/\W/g, "")}`;
      return app.inject({
        method: "POST",
        url: "/api/captures?language=en",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: multipartAudio(boundary, mime, audio),
      });
    };
    expect((await request("audio/mp4", Buffer.alloc(0))).statusCode).toBe(422);
    expect((await request("text/plain", Buffer.from("not audio"))).statusCode).toBe(415);
    expect((await request("audio/mp4", Buffer.alloc(25 * 1024 * 1024 + 1))).statusCode).toBe(413);
    expect(openai.transcribe).not.toHaveBeenCalled();
    await app.close();
  }, 20_000);

  it("selects the oldest complete notes that fit the prompt window", () => {
    const makeReady = (text: string) => {
      const note = context.repository.capture.create({
        language: "en",
        audio: Buffer.from("audio"),
        audioMime: "audio/webm",
      });
      context.repository.capture.completeTranscription(note.publicId, text);
      return note.publicId;
    };
    const oldest = makeReady("a".repeat(30_000));
    makeReady("b".repeat(20_001));
    makeReady("c".repeat(10));
    const selection = context.repository.capture.selectReady("en", 50_000);
    expect(selection.notes.map((note) => note.publicId)).toEqual([oldest]);
    expect(selection.remaining).toBe(2);
  });
});
