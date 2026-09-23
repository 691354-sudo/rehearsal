import type { RecommendationAvailability } from "../../../contracts/learning-pilot";

export function RecommendationStatus({ count, availability, loading, error, mode }: {
  count: number; availability: RecommendationAvailability | null; loading: boolean; error: string; mode: "listen" | "recall";
}) {
  const waiting = availability?.waitingCount ?? 0;
  const next = availability?.nextAvailableAt;
  return <div className="practice-recommendation-status" role="status">
    <strong>{loading ? "Loading recommendations…" : error ? "Recommendations unavailable" : `Recommended · ${count}`}</strong>
    {!loading && !error && waiting > 0 && next ? <span>
      {waiting} {waiting === 1 ? "card" : "cards"} {mode === "listen" ? "waiting" : "scheduled for later"}. Next {mode === "listen" ? "available" : "due"} {" "}
      <time dateTime={next}>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(next))}</time>.
    </span> : null}
  </div>;
}
