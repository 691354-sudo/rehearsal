import { apiFetch } from "../../shared/api";
import type { Island, IslandSummary, Language } from "../../shared/contracts";

export async function getTopics(language: Language, signal?: AbortSignal): Promise<IslandSummary[]> {
  const response = await apiFetch(`/api/islands?language=${language}`, { signal });
  if (!response.ok) throw new Error("Topics could not be loaded. Try again.");
  const topics = (await response.json()).islands as IslandSummary[];
  if (language !== "en") return topics;
  const { items: _items, ...liked } = await getTopic("liked", signal);
  return [liked, ...topics];
}

export async function getTopic(id: string, signal?: AbortSignal): Promise<Island> {
  const response = await apiFetch(id === "liked" ? "/api/pilot/liked?language=en" : `/api/islands/${encodeURIComponent(id)}`, { signal });
  if (!response.ok) throw new Error("Topic could not be loaded. Try again.");
  return (await response.json()).island;
}

export async function saveTopic(id: string, patch: { title?: string; itemIds?: string[] }): Promise<Island> {
  const response = await apiFetch(`/api/islands/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(response.status === 409 ? "A Topic with this name already exists." : "Topic could not be updated. Try again.");
  return (await response.json()).island;
}

// Read membership again on every attempt, including retries after a lost response.
export async function moveTopicCards(destinationId: string, itemIds: string[]): Promise<Island> {
  const destination = await getTopic(destinationId);
  return saveTopic(destinationId, { itemIds: [...new Set([...destination.items.map((item) => item.publicId), ...itemIds])] });
}

export async function mergeTopics(sourceId: string, destinationId: string): Promise<{ sourceRemoved: boolean }> {
  const source = await getTopic(sourceId);
  await moveTopicCards(destinationId, source.items.map((item) => item.publicId));
  // Never report a partial merge as a failure to move; do not retry the whole operation blindly.
  try {
    const remaining = await getTopic(sourceId);
    if (remaining.items.length) return { sourceRemoved: false };
    const response = await apiFetch(`/api/islands/${sourceId}`, { method: "DELETE" });
    return { sourceRemoved: response.ok };
  } catch { return { sourceRemoved: false }; }
}
