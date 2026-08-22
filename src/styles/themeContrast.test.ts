import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./base.css", import.meta.url), "utf8");

const tokensFor = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)]
    .map((match) => [match[1], match[2]]));
};

const channel = (value: number) => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) => {
  const [red, green, blue] = hex.match(/[\da-f]{2}/gi)!.map((value) => channel(Number.parseInt(value, 16)));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground: string, background: string) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};

describe.each([
  ["Warm Stone", ":root"],
  ["Graphite Haze", ':root[data-theme="dark"]'],
])("%s theme contrast", (_name, selector) => {
  const tokens = tokensFor(selector);

  it.each([
    ["ink", "canvas", 9],
    ["ink", "surface", 9],
    ["ink-support", "surface", 4.5],
    ["accent-hover", "accent-wash", 4.5],
    ["on-accent", "accent", 4.5],
  ])("keeps %s on %s at or above %s:1", (foreground, background, minimum) => {
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(minimum);
  });
});
