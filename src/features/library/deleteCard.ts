import { apiFetch } from "../../shared/api";

export const cardDeletionConsequence = "The card will be removed from Library, all categories and its review history.";
export async function deleteCard(itemId: string): Promise<boolean> {
  if (!window.confirm(`Delete this card? ${cardDeletionConsequence}`)) return false;
  const response = await apiFetch(`/api/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error("Could not delete this card. It is still here. Try again.");
  return true;
}
