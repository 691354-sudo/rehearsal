import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type ModelRouting = {
  tutor: string;
  balanced: string;
  utility: string;
  checkedAt?: string;
  source: "environment" | "openai-model-list";
};

type ModelTier = "sol" | "terra" | "luna";

const fallbackRouting = (): ModelRouting => ({
  tutor: config.tutorModel,
  balanced: config.balancedModel,
  utility: config.utilityModel,
  source: "environment",
});

const isRouting = (value: unknown): value is ModelRouting => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ModelRouting>;
  return [candidate.tutor, candidate.balanced, candidate.utility].every(
    (model) => typeof model === "string" && model.length > 0,
  );
};

export const getModelRouting = (): ModelRouting => {
  const fallback = fallbackRouting();
  if (!config.modelAutoUpdate) return fallback;
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(config.modelRoutingPath, "utf8"));
    return isRouting(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
};

const parseTieredModel = (id: string) => {
  const match = /^gpt-(\d+)\.(\d+)-(sol|terra|luna)$/.exec(id);
  if (!match) return null;
  return {
    id,
    major: Number(match[1]),
    minor: Number(match[2]),
    tier: match[3] as ModelTier,
  };
};

export const selectLatestModelRouting = (
  modelIds: string[],
  fallback = fallbackRouting(),
): ModelRouting => {
  const parsed = modelIds.map(parseTieredModel).filter((model) => model !== null);
  const latest = (tier: ModelTier, current: string) => parsed
    .filter((model) => model.tier === tier)
    .sort((left, right) => right.major - left.major || right.minor - left.minor)[0]?.id || current;

  return {
    tutor: latest("sol", fallback.tutor),
    balanced: latest("terra", fallback.balanced),
    utility: latest("luna", fallback.utility),
    source: "openai-model-list",
  };
};

export const saveModelRouting = (routing: ModelRouting) => {
  fs.mkdirSync(path.dirname(config.modelRoutingPath), { recursive: true });
  const temporaryPath = `${config.modelRoutingPath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(routing, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, config.modelRoutingPath);
};
