import { describe, expect, it } from "vitest";
import { initialCategoryDraft, selectedCategoryDraft } from "./cardCategoryDraft";

describe("category drafts", () => {
  it("makes AI proposals selectable and discards an unselected new category before saving", () => {
    const draft = { publicId: "draft", title: "Verb patterns", description: "Verb complements" };
    const initial = initialCategoryDraft({ learningCategoryIds: ["existing"], newLearningCategories: [draft] });
    expect(initial.learningCategoryIds).toEqual(["existing", "draft"]);
    expect(selectedCategoryDraft({ ...initial, learningCategoryIds: ["existing"] })).toEqual({ learningCategoryIds: ["existing"], newLearningCategories: [] });
  });
});
