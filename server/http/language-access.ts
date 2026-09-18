import type { FastifyInstance, FastifyRequest } from "fastify";
import { isLanguageCode, type LanguageCode } from "../../contracts/api.js";
import type { HttpDependencies } from "./dependencies.js";

type RequestRecord = Record<string, unknown>;

const recordOf = (value: unknown): RequestRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as RequestRecord : {};

const resourceLanguage = (
  request: FastifyRequest,
  dependencies: HttpDependencies,
) => {
  const context = dependencies.forRequest(request);
  const params = recordOf(request.params);
  const body = recordOf(request.body);
  const lookups = [
    ["item", params.itemId ?? body.itemId ?? params.cardId ?? body.cardId],
    ["island", params.islandId ?? body.topicId],
    ["learningCategory", params.categoryId],
    ["thread", params.threadId ?? body.threadId],
    ["reviewBatch", params.batchId],
    ["capture", params.captureId],
  ] as const;
  const languages: LanguageCode[] = [];
  for (const [resource, publicId] of lookups) {
    if (typeof publicId !== "string") continue;
    const language = context.repository.system.resourceLanguage(resource, publicId);
    if (language) languages.push(language);
  }
  if (Array.isArray(body.itemIds)) {
    const itemIds = body.itemIds.filter((value): value is string => typeof value === "string");
    languages.push(...context.repository.system.itemLanguages(itemIds));
  }
  return languages;
};

export const registerLanguageAccess = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/") || request.url.startsWith("/api/auth/")) return;
    const context = dependencies.forRequest(request);
    context.repository.pilot.participants.closeExpired();
    const query = recordOf(request.query);
    const body = recordOf(request.body);
    const languages = [query.language, body.language]
      .filter(isLanguageCode);
    if (request.url.startsWith("/api/pilot")) {
      if (typeof body.attemptId === "string") {
        const attempt = context.repository.pilot.recall.get(body.attemptId);
        if (attempt) languages.push(context.repository.pilot.store.item(attempt.card_id).language);
      }
      const creatingHomework = request.method === "POST" && request.routeOptions.url === "/api/pilot/homework";
      const homeworkId = recordOf(request.params).homeworkId ?? (!creatingHomework ? body.homeworkId : undefined);
      if (typeof homeworkId === "string") languages.push(context.repository.pilot.store.homework(homeworkId).language);
    }
    languages.push(...resourceLanguage(request, dependencies));
    if (request.url.startsWith("/api/pilot") && !languages.length) languages.push("en");
    if (languages.some((language) => !context.repository.system.isLanguageEnabled(language))) {
      return reply.code(403).send({ error: "LANGUAGE_NOT_ENABLED" });
    }
  });
};
