import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendationStatus } from "./RecommendationStatus";

const availability = { availableCount: 0, waitingCount: 10, nextAvailableAt: "2026-10-01T12:30:00Z", serverTime: "2026-10-01T12:00:00Z" };
describe("recommendation status", () => {
  it("shows a real zero with an individual next-availability time", () => {
    const html = renderToStaticMarkup(<RecommendationStatus count={0} availability={availability} loading={false} error="" mode="listen" />);
    expect(html).toContain("Recommended · 0");
    expect(html).toContain("10 cards waiting");
    expect(html).toContain('dateTime="2026-10-01T12:30:00Z"');
  });
  it.each([true, false])("does not turn loading or failure into zero (loading=%s)", (loading) => {
    const html = renderToStaticMarkup(<RecommendationStatus count={0} availability={availability} loading={loading} error={loading ? "" : "Network error"} mode="listen" />);
    expect(html).not.toContain("Recommended · 0");
    expect(html).not.toContain("waiting");
    expect(html).toContain(loading ? "Loading recommendations" : "Recommendations unavailable");
  });
  it("explains why nine Recall cards are recommended from eleven", () => {
    const html = renderToStaticMarkup(<RecommendationStatus count={9} availability={{ ...availability, availableCount: 9, waitingCount: 2 }} loading={false} error="" mode="recall" />);
    expect(html).toContain("Recommended · 9");
    expect(html).toContain("2 cards scheduled for later");
    expect(html).toContain("Next due");
  });
});
