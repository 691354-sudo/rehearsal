import OpenAI from "openai";
import { config, openAIConfigured } from "../server/config.js";
import {
  getModelRouting,
  saveModelRouting,
  selectLatestModelRouting,
  type ModelRouting,
} from "../server/model-routing.js";

const force = process.argv.includes("--force");
const current = getModelRouting();
const checkedAt = current.checkedAt ? new Date(current.checkedAt).getTime() : 0;
const intervalMs = config.modelCheckIntervalDays * 86_400_000;

if (!force && checkedAt && Date.now() - checkedAt < intervalMs) {
  console.log(JSON.stringify({
    ok: true,
    skipped: true,
    reason: "CHECK_INTERVAL_NOT_REACHED",
    nextCheckAt: new Date(checkedAt + intervalMs).toISOString(),
    routing: current,
  }));
  process.exit(0);
}

if (!openAIConfigured) {
  throw new Error("OPENAI_API_KEY is required to check model availability.");
}

const client = new OpenAI({ apiKey: config.openaiApiKey });
const page = await client.models.list();
const modelIds = page.data.map((model) => model.id);
const selected = selectLatestModelRouting(modelIds, current);

const candidates = [...new Set([selected.tutor, selected.balanced, selected.utility])];
for (const model of candidates) {
  await client.responses.create({
    model,
    reasoning: { effort: "none" },
    input: "Reply with OK.",
    max_output_tokens: 16,
  });
}

const next: ModelRouting = {
  ...selected,
  checkedAt: new Date().toISOString(),
  source: "openai-model-list",
};

const changed = (["tutor", "balanced", "utility"] as const).filter(
  (role) => current[role] !== next[role],
);

if (config.modelAutoUpdate) saveModelRouting(next);

console.log(JSON.stringify({
  ok: true,
  skipped: false,
  applied: config.modelAutoUpdate,
  changed,
  previous: current,
  routing: next,
}));
