import { describe, expect, it } from "vitest";
import { selectLatestModelRouting, type ModelRouting } from "./model-routing.js";

const fallback: ModelRouting = {
  tutor: "gpt-5.4",
  balanced: "gpt-5.4-mini",
  utility: "gpt-5.4-nano",
  source: "environment",
};

describe("model routing", () => {
  it("selects the newest available model independently for each workload tier", () => {
    expect(selectLatestModelRouting([
      "gpt-5.6-luna",
      "gpt-5.5-sol",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.5-luna",
    ], fallback)).toMatchObject({
      tutor: "gpt-5.6-sol",
      balanced: "gpt-5.6-terra",
      utility: "gpt-5.6-luna",
    });
  });

  it("keeps a known working fallback when a tier is absent", () => {
    expect(selectLatestModelRouting(["gpt-5.7-sol"], fallback)).toMatchObject({
      tutor: "gpt-5.7-sol",
      balanced: fallback.balanced,
      utility: fallback.utility,
    });
  });

  it("ignores dated snapshots and unrelated model names", () => {
    expect(selectLatestModelRouting([
      "gpt-5.7-sol-2026-09-01",
      "gpt-5.6-sol",
      "text-embedding-3-small",
    ], fallback).tutor).toBe("gpt-5.6-sol");
  });
});
