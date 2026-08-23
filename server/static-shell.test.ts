import { describe, expect, it } from "vitest";
import { shouldServeAppShell } from "./static-shell.js";

describe("static app shell fallback", () => {
  it("serves direct client routes", () => {
    expect(shouldServeAppShell({ method: "GET", url: "/practice/listen?lang=en", accept: "text/html" })).toBe(true);
    expect(shouldServeAppShell({ method: "HEAD", url: "/library", accept: "*/*" })).toBe(true);
    expect(shouldServeAppShell({ method: "GET", url: "/recover?fresh=123", accept: "text/html" })).toBe(true);
  });

  it("does not turn missing assets or API routes into HTML", () => {
    expect(shouldServeAppShell({ method: "GET", url: "/assets/old-build.js", accept: "*/*" })).toBe(false);
    expect(shouldServeAppShell({ method: "GET", url: "/manifest.webmanifest", accept: "*/*" })).toBe(false);
    expect(shouldServeAppShell({ method: "GET", url: "/api/items", accept: "text/html" })).toBe(false);
    expect(shouldServeAppShell({ method: "GET", url: "/health", accept: "text/html" })).toBe(false);
  });
});
