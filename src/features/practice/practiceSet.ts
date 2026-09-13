import type { PracticeSet } from "../../../contracts/learning-categories";
import type { PracticeRoute } from "../../lib/appRoute";

export function practiceSet(value: string): PracticeSet {
  if (!value) return { kind: "all" };
  if (value === "liked") return { kind: "liked" };
  return value.startsWith("category:") ? { kind: "category", id: value.slice(9) } : { kind: "topic", id: value };
}
export const practiceSetValue = (route: Pick<PracticeRoute, "topic" | "category">) => route.category ? `category:${route.category}` : route.topic;
export const practiceSetRoute = (value: string): Pick<PracticeRoute, "topic" | "category"> => {
  const set = practiceSet(value);
  return { topic: set.kind === "topic" ? set.id : set.kind === "liked" ? "liked" : "", category: set.kind === "category" ? set.id : undefined };
};
