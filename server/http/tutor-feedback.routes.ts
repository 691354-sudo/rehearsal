import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tutorFeedbackMaxLength } from "../../contracts/tutor-feedback.js";
import type { HttpDependencies } from "./dependencies.js";

const paramsSchema = z.object({ threadId: z.string().uuid(), messageId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

export const registerTutorFeedbackRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.put("/api/chat/:threadId/messages/:messageId/feedback", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const { threadId, messageId } = paramsSchema.parse(request.params);
    const { text } = z.object({ text: z.string().trim().min(1).max(tutorFeedbackMaxLength) }).parse(request.body);
    const feedback = repository.tutor.feedback.save(threadId, messageId, text);
    return feedback ? { feedback } : reply.code(404).send({ error: "TUTOR_MESSAGE_NOT_FOUND" });
  });

  app.delete("/api/chat/:threadId/messages/:messageId/feedback", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const { threadId, messageId } = paramsSchema.parse(request.params);
    return repository.tutor.feedback.remove(threadId, messageId)
      ? reply.code(204).send() : reply.code(404).send({ error: "TUTOR_MESSAGE_NOT_FOUND" });
  });
};
