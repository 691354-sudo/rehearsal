import OpenAI from "openai";
import { config, openAIConfigured } from "../server/config.js";

if (!openAIConfigured) {
  throw new Error("OPENAI_API_KEY is required to check model availability.");
}

const client = new OpenAI({ apiKey: config.openaiApiKey });
const routing = {
  tutor: config.tutorModel,
  balanced: config.balancedModel,
  utility: config.utilityModel,
};
const candidates = [...new Set(Object.values(routing))];
for (const model of candidates) {
  await client.responses.create({
    model,
    reasoning: { effort: "none" },
    input: "Reply with OK.",
    max_output_tokens: 16,
  });
}

console.log(JSON.stringify({
  ok: true,
  checkedAt: new Date().toISOString(),
  applied: false,
  routing,
}));
