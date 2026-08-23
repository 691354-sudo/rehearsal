import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

class ScriptElement {
  src = "https://example.test/rehearsal/app-recovery.js";
}

class LinkElement {
  href = "";
  rel = "stylesheet";
}

const runRecovery = ({ pathname = "/rehearsal/tutor/chat", search = "?lang=en" } = {}) => {
  const listeners = new Map<string, (event: unknown) => void>();
  const storage = new Map<string, string>();
  const root = { childElementCount: 0, replaceChildren: vi.fn() };
  const replace = vi.fn();
  const replaceState = vi.fn();
  const unregister = vi.fn().mockResolvedValue(true);
  const location = {
    href: `https://example.test${pathname}${search}`,
    origin: "https://example.test",
    pathname,
    search,
    hash: "",
    replace,
    reload: vi.fn(),
  };
  const sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  };
  const document = {
    currentScript: new ScriptElement(),
    createElement: (tag: string) => ({
      addEventListener: vi.fn(),
      append: vi.fn(),
      className: "",
      href: "",
      setAttribute: vi.fn(),
      textContent: "",
      type: tag === "button" ? "button" : undefined,
    }),
    getElementById: () => root,
  };
  const window = {
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    history: { replaceState, state: null },
    location,
    sessionStorage,
    setTimeout: (callback: () => void) => { callback(); return 1; },
  };
  const context = {
    console,
    document,
    HTMLLinkElement: LinkElement,
    HTMLScriptElement: ScriptElement,
    navigator: { serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ scope: "https://example.test/rehearsal/", unregister }]) } },
    URL,
    window,
  };
  const source = fs.readFileSync(new URL("./app-recovery.js", import.meta.url), "utf8");
  vm.runInNewContext(source, context);
  return { listeners, location, replace, replaceState, root, storage, unregister };
};

describe("stable app recovery", () => {
  it("moves a failed deep link through the network-only recovery route", async () => {
    const harness = runRecovery();
    harness.listeners.get("error")?.({ target: Object.assign(new ScriptElement(), { src: "https://example.test/rehearsal/assets/old.js" }) });
    await vi.waitFor(() => expect(harness.replace).toHaveBeenCalled());
    expect(harness.storage.get("echo:asset-recovery-target")).toBe("/rehearsal/tutor/chat?lang=en");
    expect(harness.replace.mock.calls[0][0]).toMatch(/^https:\/\/example\.test\/rehearsal\/recover\?fresh=/);
    expect(harness.unregister).toHaveBeenCalledOnce();
  });

  it("restores the deep link before the fresh application mounts", () => {
    const harness = runRecovery({ pathname: "/rehearsal/recover", search: "?fresh=123" });
    harness.storage.set("echo:asset-recovery-target", "/rehearsal/tutor/chat?lang=en&thread=9bbf06f1-0d51-4d95-83a4-e72c09c7a3f4");
    harness.listeners.get("pageshow")?.({});
    expect(harness.replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/rehearsal/tutor/chat?lang=en&thread=9bbf06f1-0d51-4d95-83a4-e72c09c7a3f4",
    );
  });

  it("shows a fallback instead of retrying forever", async () => {
    const harness = runRecovery();
    harness.storage.set("echo:asset-recovery", "1");
    harness.listeners.get("error")?.({ target: Object.assign(new ScriptElement(), { src: "https://example.test/rehearsal/assets/old.js" }) });
    await vi.waitFor(() => expect(harness.root.replaceChildren).toHaveBeenCalledOnce());
    expect(harness.replace).not.toHaveBeenCalled();
  });
});
