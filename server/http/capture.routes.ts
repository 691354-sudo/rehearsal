import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpContext, HttpDependencies } from "./dependencies.js";
import { audioUploadExtension } from "./audio-upload.js";
import { languageSchema } from "./schemas.js";

export const registerCaptureRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  const transcribe = async (publicId: string, context: HttpContext) => {
    const { repository, openai } = context;
    const stored = repository.capture.getAudio(publicId);
    if (!stored?.audio?.byteLength) throw new Error("CAPTURE_AUDIO_NOT_FOUND");
    const extension = audioUploadExtension(stored.audio_mime);
    if (!extension) throw new Error("UNSUPPORTED_AUDIO_TYPE");
    const transcript = await openai.transcribe({
      audio: stored.audio,
      audioMime: stored.audio_mime,
      filename: `capture-${publicId}.${extension}`,
    });
    return repository.capture.completeTranscription(publicId, transcript)!;
  };

  app.get("/api/captures", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({
      language: languageSchema,
      includeProcessed: z.coerce.boolean().default(false),
    }).parse(request.query);
    return {
      notes: repository.capture.list(query.language, query.includeProcessed),
      activeBatch: repository.capture.getActiveBatch(query.language),
    };
  });

  app.post("/api/captures", async (request, reply) => {
    const context = dependencies.forRequest(request);
    const { repository } = context;
    const query = z.object({ language: languageSchema }).parse(request.query);
    const uploadId = z.string().uuid().optional().parse(request.headers["x-rehearsal-capture-id"]);
    const upload = await request.file();
    if (!upload) return reply.code(400).send({ error: "AUDIO_REQUIRED" });
    const mime = upload.mimetype.toLocaleLowerCase().split(";")[0];
    if (!audioUploadExtension(mime)) {
      await upload.toBuffer();
      return reply.code(415).send({ error: "UNSUPPORTED_AUDIO_TYPE", mime });
    }
    const audio = await upload.toBuffer();
    if (!audio.byteLength) return reply.code(422).send({ error: "EMPTY_AUDIO" });
    const existing = uploadId ? repository.capture.get(uploadId) : null;
    if (existing) {
      if (existing.language !== query.language) {
        return reply.code(409).send({ error: "CAPTURE_UPLOAD_CONFLICT" });
      }
      return reply.send({
        note: existing,
        duplicate: true,
        transcriptionFailed: existing.status === "failed",
      });
    }
    const created = repository.capture.create({
      publicId: uploadId,
      language: query.language,
      audio,
      audioMime: mime,
    });
    try {
      return reply.code(201).send({ note: await transcribe(created.publicId, context) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "TRANSCRIPTION_FAILED";
      const note = repository.capture.failTranscription(created.publicId, message)!;
      return reply.code(201).send({ note, transcriptionFailed: true });
    }
  });

  app.post("/api/captures/text", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({
      language: languageSchema,
      transcript: z.string().trim().min(1).max(30_000),
    }).parse(request.body);
    return reply.code(201).send({ note: repository.capture.createText(body) });
  });

  app.post("/api/captures/:captureId/retry", async (request, reply) => {
    const context = dependencies.forRequest(request);
    const { repository } = context;
    const params = z.object({ captureId: z.string().uuid() }).parse(request.params);
    const note = repository.capture.markTranscribing(params.captureId);
    if (!note) return reply.code(409).send({ error: "CAPTURE_NOT_RETRYABLE" });
    try {
      return { note: await transcribe(params.captureId, context) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "TRANSCRIPTION_FAILED";
      return { note: repository.capture.failTranscription(params.captureId, message), transcriptionFailed: true };
    }
  });

  app.patch("/api/captures/:captureId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ captureId: z.string().uuid() }).parse(request.params);
    const body = z.object({ transcript: z.string().trim().min(1).max(30_000) }).parse(request.body);
    const note = repository.capture.updateTranscript(params.captureId, body.transcript);
    if (note) return { note };
    if (!repository.capture.get(params.captureId)) return reply.code(404).send({ error: "CAPTURE_NOT_FOUND" });
    return reply.code(409).send({ error: "CAPTURE_NOT_EDITABLE" });
  });

  app.delete("/api/captures/:captureId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ captureId: z.string().uuid() }).parse(request.params);
    if (!repository.capture.get(params.captureId)) return reply.code(404).send({ error: "CAPTURE_NOT_FOUND" });
    if (!repository.capture.delete(params.captureId)) return reply.code(409).send({ error: "CAPTURE_IN_REVIEW" });
    return reply.code(204).send();
  });

  app.post("/api/captures/process", async (request, reply) => {
    const { repository, openai } = dependencies.forRequest(request);
    const body = z.object({ language: languageSchema }).parse(request.body);
    const activeBatch = repository.capture.getActiveBatch(body.language);
    if (activeBatch) return { batch: activeBatch, existing: true, remaining: 0 };
    const selection = repository.capture.selectReady(body.language, 50_000);
    if (!selection.notes.length) return reply.code(400).send({ error: "NO_READY_CAPTURES" });
    const prepared = await openai.prepareCaptureBatch({ language: body.language, notes: selection.notes });
    repository.capture.attachToBatch(selection.notes.map((note) => note.publicId), prepared.batch.publicId);
    repository.library.saveSource({
      language: body.language,
      title: "Capture Reality",
      rawText: selection.notes.map((note) => note.transcript).join("\n\n"),
      kind: "capture_notebook",
      metadata: { captureNoteIds: selection.notes.map((note) => note.publicId), batchId: prepared.batch.publicId },
    });
    return reply.code(201).send({ ...prepared, remaining: selection.remaining });
  });
};
