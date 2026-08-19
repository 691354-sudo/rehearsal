import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { itemBodySchema, languageSchema } from "./schemas.js";

export const registerItemRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/items", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({
      language: languageSchema.default("en"),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(request.query);
    return { items: repository.items.list(query.language, query.limit) };
  });

  app.post("/api/items", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const body = itemBodySchema.parse(request.body);
    const item = repository.items.save({
      ...body,
      source: "Manual entry",
      naturalness: 5,
      commonness: 5,
      status: "new",
      register: "casual",
    });
    return reply.code(201).send({ item });
  });

  app.patch("/api/items/:itemId/preference", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = z.object({ preference: z.enum(["like", "neutral", "dislike"]) }).parse(request.body);
    const item = repository.items.updatePreference(params.itemId, body.preference);
    return item ? { item } : reply.code(404).send({ error: "ITEM_NOT_FOUND" });
  });

  app.patch("/api/items/:itemId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      target: z.string().trim().min(1).max(2_000).optional(),
      cue: z.string().trim().min(1).max(2_000).optional(),
      note: z.string().trim().max(2_000).optional(),
      tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
      preference: z.enum(["like", "neutral", "dislike"]).optional(),
      frequencyBand: z.enum(["core", "common", "specific", "rare"]).optional(),
      practiceEnabled: z.boolean().optional(),
    }).parse(request.body);
    const item = repository.items.update(params.itemId, body);
    return item ? { item } : reply.code(404).send({ error: "ITEM_NOT_FOUND" });
  });

  app.delete("/api/items/:itemId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    if (!repository.items.delete(params.itemId)) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    return reply.code(204).send();
  });

  app.get("/api/search", async (request) => {
    const { repository, openai } = dependencies.forRequest(request);
    const query = z.object({
      q: z.string().trim().min(1).max(500),
      language: languageSchema.default("en"),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(request.query);
    const embedding = await openai.embed(query.q);
    return {
      items: repository.items.search(query.q, query.language, embedding || undefined, query.limit),
      mode: embedding ? "hybrid" : "keyword",
    };
  });

  app.post("/api/import/text", async (request, reply) => {
    const { repository, openai } = dependencies.forRequest(request);
    const body = z.object({
      language: languageSchema,
      title: z.string().trim().min(1).max(300),
      text: z.string().trim().min(1).max(200_000),
    }).parse(request.body);
    const source = repository.library.saveSource({
      language: body.language,
      title: body.title,
      rawText: body.text,
      kind: "text",
    });
    const prepared = await openai.prepareImportedMaterial(body);
    const previewSentences = body.text
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .slice(0, 50);
    return reply.code(201).send({ source, prepared, batch: prepared.batch, previewSentences });
  });

  app.post("/api/items/:itemId/pattern-drill", async (request, reply) => {
    const { repository, openai } = dependencies.forRequest(request);
    const params = z.object({ itemId: z.string().min(1) }).parse(request.params);
    const item = repository.items.get(params.itemId);
    if (!item) return reply.code(404).send({ error: "ITEM_NOT_FOUND" });
    return reply.code(201).send(await openai.generatePatternDrill({ language: item.language, item }));
  });

  app.post("/api/islands", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const body = z.object({
      language: languageSchema,
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(2_000).optional(),
      itemIds: z.array(z.string()).max(500).default([]),
    }).parse(request.body);
    return reply.code(201).send({
      island: repository.library.createIsland({
        language: body.language,
        title: body.title,
        description: body.description,
        itemPublicIds: body.itemIds,
      }),
    });
  });

  app.get("/api/islands", async (request) => {
    const { repository } = dependencies.forRequest(request);
    const query = z.object({ language: languageSchema }).parse(request.query);
    return { islands: repository.library.listIslands(query.language) };
  });

  app.get("/api/islands/:islandId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ islandId: z.string().uuid() }).parse(request.params);
    const island = repository.library.getIsland(params.islandId);
    return island ? { island } : reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
  });

  app.patch("/api/islands/:islandId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ islandId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(2_000).optional(),
      itemIds: z.array(z.string()).max(500).optional(),
    }).refine((value) => value.title !== undefined
      || value.description !== undefined || value.itemIds !== undefined, {
      message: "At least one Topic field is required",
    }).parse(request.body);
    const island = repository.library.updateIsland(params.islandId, {
      title: body.title,
      description: body.description,
      itemPublicIds: body.itemIds,
    });
    return island ? { island } : reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
  });

  app.delete("/api/islands/:islandId", async (request, reply) => {
    const { repository } = dependencies.forRequest(request);
    const params = z.object({ islandId: z.string().uuid() }).parse(request.params);
    if (!repository.library.deleteIsland(params.islandId)) {
      return reply.code(404).send({ error: "TOPIC_NOT_FOUND" });
    }
    return reply.code(204).send();
  });
};
