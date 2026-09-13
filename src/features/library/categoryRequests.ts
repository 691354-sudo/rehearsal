import type { LearningCategory, LearningCategorySummary } from "../../../contracts/learning-categories";
import { apiFetch } from "../../shared/api";
import type { Language } from "../../shared/contracts";

export async function getCategories(language: Language, signal?: AbortSignal): Promise<{
  categories: LearningCategorySummary[]; redirects: Record<string, string>;
}> {
  const response = await apiFetch(`/api/learning-categories?language=${language}`, { signal });
  if (!response.ok) throw new Error("Learning categories could not be loaded.");
  const data = await response.json() as { categories: LearningCategorySummary[]; redirects: Array<{ topicId: string; categoryId: string }> };
  return { categories: data.categories, redirects: Object.fromEntries(data.redirects.map((entry) => [entry.topicId, entry.categoryId])) };
}
export async function getCategory(id: string, signal?: AbortSignal): Promise<LearningCategory> {
  const response = await apiFetch(`/api/learning-categories/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error("This category could not be loaded.");
  return (await response.json()).category;
}
export async function writeCategory(path: string, method: string, body?: unknown) {
  const response = await apiFetch(`/api/learning-categories${path}`, {
    method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(response.status === 409
    ? "A category with this name already exists." : "Could not save this change. Try again.");
  return response.status === 204 ? null : response.json();
}
export async function addCardsToCategories(language: Language, categoryIds: string[], itemIds: string[]) {
  return writeCategory("/add-cards", "POST", { language, categoryIds, itemIds });
}
