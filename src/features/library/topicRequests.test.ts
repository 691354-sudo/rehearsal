import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../shared/api";
import { mergeTopics, moveTopicCards } from "./topicRequests";

vi.mock("../../shared/api", () => ({ apiFetch: vi.fn() }));
const fetch = vi.mocked(apiFetch);
const island = (itemIds: string[]) => Response.json({ island: { items: itemIds.map((publicId) => ({ publicId })) } });

beforeEach(() => fetch.mockReset());
describe("Topic transfers", () => {
  it("preserves destination cards and does not duplicate a move after a lost response", async () => {
    fetch.mockResolvedValueOnce(island(["existing", "moved"])).mockResolvedValueOnce(island(["existing", "moved", "next"]));
    await moveTopicCards("destination", ["moved", "next"]);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ itemIds: ["existing", "moved", "next"] });
  });
  it("never deletes the source if the transfer fails", async () => {
    fetch.mockResolvedValueOnce(island(["a"])).mockResolvedValueOnce(island(["b"])).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(mergeTopics("source", "destination")).rejects.toThrow("could not be updated");
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("reports partial success when source deletion fails", async () => {
    fetch.mockResolvedValueOnce(island(["a"])).mockResolvedValueOnce(island(["b"]))
      .mockResolvedValueOnce(island(["b", "a"])).mockResolvedValueOnce(island([])).mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(mergeTopics("source", "destination")).resolves.toEqual({ sourceRemoved: false });
  });
  it("keeps the completed transfer explicit when the delete response is lost", async () => {
    fetch.mockResolvedValueOnce(island(["a"])).mockResolvedValueOnce(island(["b"]))
      .mockResolvedValueOnce(island(["b", "a"])).mockResolvedValueOnce(island([])).mockRejectedValueOnce(new TypeError("Network error"));
    await expect(mergeTopics("source", "destination")).resolves.toEqual({ sourceRemoved: false });
  });
  it("does not delete cards added to the source during the transfer", async () => {
    fetch.mockResolvedValueOnce(island(["a"])).mockResolvedValueOnce(island(["b"]))
      .mockResolvedValueOnce(island(["b", "a"])).mockResolvedValueOnce(island(["new arrival"]));
    await expect(mergeTopics("source", "destination")).resolves.toEqual({ sourceRemoved: false });
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });
  it("removes only the empty source after a successful transfer", async () => {
    fetch.mockResolvedValueOnce(island(["a"])).mockResolvedValueOnce(island(["b"]))
      .mockResolvedValueOnce(island(["b", "a"])).mockResolvedValueOnce(island([])).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(mergeTopics("source", "destination")).resolves.toEqual({ sourceRemoved: true });
    expect(fetch).toHaveBeenLastCalledWith("/api/islands/source", { method: "DELETE" });
  });
});
