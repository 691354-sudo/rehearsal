import { describe, expect, it } from "vitest";
import { placeLibraryActions } from "./libraryActions";

describe("Library card action placement", () => {
  it("opens above a card near the mobile tab bar", () => {
    expect(placeLibraryActions(
      { top: 690, right: 370, bottom: 734 },
      { width: 168, height: 220 },
      { width: 393, bottom: 760 },
    )).toEqual({ left: 202, placement: "above", top: 464 });
  });

  it("opens below when the full menu fits and clamps it inside the viewport", () => {
    expect(placeLibraryActions(
      { top: 80, right: 150, bottom: 124 },
      { width: 168, height: 220 },
      { width: 320, bottom: 700 },
    )).toEqual({ left: 8, placement: "below", top: 130 });
  });
});
