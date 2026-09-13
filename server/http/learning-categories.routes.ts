import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpDependencies } from "./dependencies.js";
import { languageSchema, nfcText } from "./schemas.js";

const paramsSchema = z.object({ categoryId: z.string().uuid() });
const itemIdsSchema = z.array(z.string().min(1)).min(1).max(500);

export const registerLearningCategoryRoutes = (app: FastifyInstance, dependencies: HttpDependencies) => {
  app.get("/api/learning-categories", async (request) => {
    const { language } = z.object({ language: languageSchema }).parse(request.query);
    const { categories } = dependencies.forRequest(request).repository;
    return { categories: categories.list(language), redirects: categories.redirects(language) };
  });
  app.post("/api/learning-categories", async (request, reply) => {
    const body = z.object({ language: languageSchema, publicId: z.string().uuid().optional(),
      title: nfcText(200), description: z.string().trim().max(2_000).optional() }).parse(request.body);
    return reply.code(201).send({ category: dependencies.forRequest(request).repository.categories.create(body) });
  });
  app.get("/api/learning-categories/:categoryId", async (request, reply) => {
    const { categoryId } = paramsSchema.parse(request.params);
    const category = dependencies.forRequest(request).repository.categories.get(categoryId);
    return category ? { category } : reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
  });
  app.patch("/api/learning-categories/:categoryId", async (request, reply) => {
    const { categoryId } = paramsSchema.parse(request.params);
    const body = z.object({ title: nfcText(200).optional(), description: z.string().trim().max(2_000).optional() }).parse(request.body);
    const category = dependencies.forRequest(request).repository.categories.update(categoryId, body);
    return category ? { category } : reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
  });
  app.delete("/api/learning-categories/:categoryId", async (request, reply) => {
    const { categoryId } = paramsSchema.parse(request.params);
    return dependencies.forRequest(request).repository.categories.delete(categoryId)
      ? reply.code(204).send() : reply.code(404).send({ error: "CATEGORY_NOT_FOUND" });
  });
  app.post("/api/learning-categories/add-cards", async (request) => {
    const body = z.object({ language: languageSchema, categoryIds: z.array(z.string().uuid()).min(1).max(100), itemIds: itemIdsSchema }).parse(request.body);
    dependencies.forRequest(request).repository.categories.addToCards(body.language, body.categoryIds, body.itemIds);
    return { added: body.itemIds };
  });
  app.delete("/api/learning-categories/:categoryId/cards", async (request) => {
    const { categoryId } = paramsSchema.parse(request.params);
    const { itemIds } = z.object({ itemIds: itemIdsSchema }).parse(request.body);
    dependencies.forRequest(request).repository.categories.removeCards(categoryId, itemIds);
    return { removed: itemIds };
  });
};
