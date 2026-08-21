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
    ["item", params.itemId ?? body.itemId],
    ["island", params.islandId],
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
    const query = recordOf(request.query);
    const body = recordOf(request.body);
    const languages = [query.language, body.language]
      .filter(isLanguageCode);
    languages.push(...resourceLanguage(request, dependencies));
    if (languages.some((language) => !context.repository.system.isLanguageEnabled(language))) {
      return reply.code(403).send({ error: "LANGUAGE_NOT_ENABLED" });
    }
  });
};
