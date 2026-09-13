import { afterEach, describe, expect, it, vi } from "vitest";
import { getCategories, writeCategory } from "./categoryRequests";
import { apiFetch } from "../../shared/api";
vi.mock("../../shared/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("category request contracts", () => {
  it("resolves migrated Topic links from the API redirect list", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ categories: [], redirects: [{ topicId: "old", categoryId: "same-set" }] })));
    expect((await getCategories("en")).redirects.old).toBe("same-set");
  });
  it("deletes a category without sending an empty JSON body", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect(await writeCategory("/category-id", "DELETE")).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith("/api/learning-categories/category-id", { method: "DELETE" });
  });
});
