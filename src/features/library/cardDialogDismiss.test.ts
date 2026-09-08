import { describe, expect, it } from "vitest";
import { createCardDialogDismiss } from "./cardDialogDismiss";

describe("card dialog backdrop gestures", () => {
  const dialog = { getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 600 }) } as HTMLDialogElement;
  const event = (x: number, target: EventTarget = dialog) => ({ target, currentTarget: dialog, clientX: x, clientY: 200, button: 0 });
  it("keeps a selection that starts in a field and ends on the backdrop", () => {
    const dismiss = createCardDialogDismiss();
    dismiss.onPointerDownCapture(event(200, {} as EventTarget));
    expect(dismiss.shouldClose(event(700))).toBe(false);
  });
  it("closes only a fresh click that starts and ends on the backdrop", () => {
    const dismiss = createCardDialogDismiss();
    dismiss.onPointerDownCapture(event(700));
    expect(dismiss.shouldClose(event(700))).toBe(true);
    expect(dismiss.shouldClose(event(700))).toBe(false);
    dismiss.onPointerDownCapture(event(700));
    expect(dismiss.shouldClose(event(200))).toBe(false);
    dismiss.onPointerDownCapture(event(200));
    expect(dismiss.shouldClose(event(200))).toBe(false);
  });
  it("ignores cancelled and secondary pointer gestures", () => {
    const dismiss = createCardDialogDismiss();
    dismiss.onPointerDownCapture(event(700)); dismiss.onPointerCancel();
    expect(dismiss.shouldClose(event(700))).toBe(false);
    dismiss.onPointerDownCapture({ ...event(700), button: 2 });
    expect(dismiss.shouldClose(event(700))).toBe(false);
  });
});
