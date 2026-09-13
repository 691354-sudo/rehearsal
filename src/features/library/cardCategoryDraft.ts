import type { CardCategoriesInput } from "../../../contracts/learning-categories";

export const initialCategoryDraft = (input: CardCategoriesInput): CardCategoriesInput => ({
  learningCategoryIds: [...new Set([...(input.learningCategoryIds || []), ...(input.newLearningCategories || []).map((draft) => draft.publicId)])],
  newLearningCategories: input.newLearningCategories || [],
});
export const selectedCategoryDraft = (input: CardCategoriesInput): CardCategoriesInput => ({
  learningCategoryIds: input.learningCategoryIds || [],
  newLearningCategories: (input.newLearningCategories || []).filter((draft) => input.learningCategoryIds?.includes(draft.publicId)),
});
