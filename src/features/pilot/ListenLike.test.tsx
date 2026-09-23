import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningItem } from "../../shared/contracts";
import { ListenLike } from "./ListenLike";

const pilot = vi.hoisted(() => ({ progress: {} as Record<string, { learningStage: "listen" | "recall" | "tutor" }>,
  recallPendingIds: [] as string[], syncError: "", refreshCard: vi.fn(), toRecall: vi.fn(), like: vi.fn(), retry: vi.fn() }));
vi.mock("./PilotProvider", () => ({ usePilot: () => pilot }));
const item = { publicId: "card-1", preference: "neutral" } as LearningItem;
const markup = () => renderToStaticMarkup(<ListenLike item={item} />);

describe("To Recall state in the Listen player", () => {
  beforeEach(() => { pilot.progress = {}; pilot.recallPendingIds = []; });

  it.each(["recall", "tutor"] as const)("keeps a filled, inactive arrow after entering %s", (learningStage) => {
    pilot.progress[item.publicId] = { learningStage };
    const html = markup();
    expect(html).toContain('aria-pressed="true" aria-disabled="true"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("To Recall");
  });

  it("returns to an outlined actionable arrow when the card returns to Listen", () => {
    pilot.progress[item.publicId] = { learningStage: "listen" };
    expect(markup()).toContain('aria-pressed="false" aria-disabled="false"');
    expect(markup()).not.toContain('fill="currentColor"');
  });

  it("does not show a successful transfer before pending progress is saved", () => {
    pilot.recallPendingIds = [item.publicId];
    expect(markup()).toContain('aria-pressed="false" aria-disabled="true"');
    expect(markup()).toContain("Sending…");
    expect(markup()).not.toContain('fill="currentColor"');
  });
});
