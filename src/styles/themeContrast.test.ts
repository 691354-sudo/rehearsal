import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./base.css", import.meta.url), "utf8");

const declarationsFor = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/gi)]
    .map((match) => [match[1], match[2]]));
};

const tokensFor = (selector: string) => {
  const declarations = selector === ":root"
    ? declarationsFor(":root")
    : { ...declarationsFor(":root"), ...declarationsFor(selector) };
  const resolve = (name: string, seen = new Set<string>()): string => {
    if (seen.has(name)) throw new Error(`Circular color token: ${name}`);
    const value = declarations[name];
    const reference = value?.match(/^var\(--([\w-]+)\)$/)?.[1];
    return reference ? resolve(reference, new Set([...seen, name])) : value;
  };
  return Object.fromEntries(Object.keys(declarations).map((name) => [name, resolve(name)]));
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
  ["Warm Sand", ":root"],
  ["Graphite Haze", ':root[data-theme="dark"]'],
])("%s theme contrast", (_name, selector) => {
  const tokens = tokensFor(selector);

  it.each([
    ["ink", "canvas", 9],
    ["ink", "surface", 9],
    ["ink-support", "surface", 4.5],
    ["ink-faint", "surface", 4.5],
    ["ink", "accent-wash", 4.5],
    ["on-accent", "accent", 4.5],
    ["learned", "surface", 4.5],
    ["note", "surface", 4.5],
  ])("keeps %s on %s at or above %s:1", (foreground, background, minimum) => {
    expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(minimum);
  });

  it("keeps the retry indicator distinct from its surface", () => {
    expect(contrast(tokens.retry, tokens.surface)).toBeGreaterThanOrEqual(3);
  });

  it("uses the approved accent", () => {
    const accent = tokens["rh-accent"]?.replace(/^#/, "").toLowerCase();
    expect(accent).toBe(selector === ":root" ? "cda56d" : "d8b57f");
  });
});
