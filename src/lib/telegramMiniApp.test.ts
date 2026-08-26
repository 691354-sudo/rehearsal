import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureTelegramBackButton,
  initializeTelegramMiniApp,
  isTelegramMiniApp,
} from "./telegramMiniApp";

describe("Telegram Mini App bridge", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("keeps the ordinary PWA inert when the bridge is absent", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { Telegram: undefined } });
    expect(isTelegramMiniApp()).toBe(false);
    expect(() => initializeTelegramMiniApp()).not.toThrow();
  });

  it("publishes viewport and safe areas, expands, and wires native BackButton", () => {
    const events = new Map<string, () => void>();
    const setProperty = vi.fn();
    const addClass = vi.fn();
    const show = vi.fn();
    const hide = vi.fn();
    const onClick = vi.fn();
    const offClick = vi.fn();
    const ready = vi.fn();
    const expand = vi.fn();
    const webApp = {
      initData: "auth_date=1&hash=test",
      colorScheme: "light" as const,
      viewportHeight: 700,
      safeAreaInset: { top: 10, right: 0, bottom: 20, left: 0 },
      contentSafeAreaInset: { top: 4, right: 2, bottom: 6, left: 2 },
      BackButton: { show, hide, onClick, offClick },
      ready,
      expand,
      onEvent: (name: string, callback: () => void) => events.set(name, callback),
      offEvent: vi.fn(),
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { Telegram: { WebApp: webApp }, innerHeight: 640, history: { back: vi.fn() }, dispatchEvent: vi.fn() },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { documentElement: { classList: { add: addClass }, style: { setProperty } } },
    });

    initializeTelegramMiniApp();
    expect(addClass).toHaveBeenCalledWith("telegram-mini-app");
    expect(setProperty).toHaveBeenCalledWith("--echo-viewport-height", "700px");
    expect(setProperty).toHaveBeenCalledWith("--tg-safe-area-inset-bottom", "20px");
    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
    events.get("viewportChanged")?.();
    events.get("deactivated")?.();
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "telegram-deactivated" }));

    const cleanup = configureTelegramBackButton(true);
    expect(show).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    cleanup();
    expect(offClick).toHaveBeenCalledOnce();
    configureTelegramBackButton(false)();
    expect(hide).toHaveBeenCalledOnce();
  });
});
