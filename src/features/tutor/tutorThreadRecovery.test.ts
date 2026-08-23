import { describe, expect, it, vi } from "vitest";
import { clearMissingTutorThread } from "./tutorThreadRecovery";

describe("missing Tutor threads", () => {
  it("clears only the deleted thread from persisted Tutor state", () => {
    const removeItem = vi.fn();
    clearMissingTutorThread({ getItem: () => "deleted-thread", removeItem }, "tutor:thread", "deleted-thread");
    expect(removeItem).toHaveBeenCalledWith("tutor:thread");

    removeItem.mockClear();
    clearMissingTutorThread({ getItem: () => "current-thread", removeItem }, "tutor:thread", "deleted-thread");
    expect(removeItem).not.toHaveBeenCalled();
  });
});
