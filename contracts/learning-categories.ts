import type { Island, IslandSummary } from "./api.js";

export type LearningCategorySummary = IslandSummary;
export type LearningCategory = Island;
export type LearningCategoryDraft = { publicId: string; title: string; description: string };
export type CardCategoriesInput = {
  learningCategoryIds?: string[];
  newLearningCategories?: LearningCategoryDraft[];
};
export type PracticeSet = { kind: "all" } | { kind: "liked" }
  | { kind: "topic" | "category"; id: string };

export const categoryTitleKey = (title: string) => title.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
