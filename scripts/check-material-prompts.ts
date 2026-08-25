import { randomUUID } from "node:crypto";
import { config, openAIConfigured } from "../server/config.js";
import { OpenAIService } from "../server/services/openai.js";
import { TutorService } from "../server/services/tutor.js";
import { createApiTestContext } from "../server/testing/api-test-context.js";
import type { ReviewCandidate } from "../server/types.js";
import { materialPromptScenarios, type PromptEvalScenario } from "./material-prompt-scenarios.js";

if (process.env.CONFIRM_PROMPT_EVAL !== "1") {
  throw new Error("Set CONFIRM_PROMPT_EVAL=1 to authorize paid, non-mutating OpenAI prompt evaluations.");
}
if (!openAIConfigured) throw new Error("OPENAI_API_KEY is required for prompt evaluations.");

const requestedIds = new Set((process.env.PROMPT_EVAL_SCENARIOS || "").split(",").map((id) => id.trim()).filter(Boolean));
const scenarios = requestedIds.size
  ? materialPromptScenarios.filter((scenario) => requestedIds.has(scenario.id))
  : materialPromptScenarios;
const missingIds = [...requestedIds].filter((id) => !scenarios.some((scenario) => scenario.id === id));
if (missingIds.length) throw new Error(`Unknown prompt eval scenarios: ${missingIds.join(", ")}`);
const concurrency = Math.max(1, Math.min(4, Number(process.env.PROMPT_EVAL_CONCURRENCY) || 2));

type ScenarioResult = {
  id: string;
  name: string;
  passed: boolean;
  issues: string[];
  cards: ReviewCandidate[];
  tutorReplies: string[];
  durationMs: number;
  error?: string;
};

const storedItemCount = (context: ReturnType<typeof createApiTestContext>) =>
  (context.db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number }).count;

const runScenario = async (scenario: PromptEvalScenario): Promise<ScenarioResult> => {
  const startedAt = Date.now();
  const context = createApiTestContext();
  const beforeItems = storedItemCount(context);
  const tutorReplies: string[] = [];
  try {
    const openai = new OpenAIService(context.repository);
    let cards: ReviewCandidate[] = [];
    if (scenario.flow.type === "tutor") {
      const tutor = new TutorService(context.repository, openai);
      let threadId: string | undefined;
      for (const message of scenario.flow.turns) {
        const reply = await tutor.chat({
          language: scenario.language,
          message,
          threadPublicId: threadId,
          clientMessageId: randomUUID(),
        });
        threadId = reply.threadId;
        tutorReplies.push(reply.content);
      }
      const review = threadId ? await tutor.review(threadId) : null;
      cards = review?.batch.candidates || [];
    } else {
      const prepared = await openai.prepareCaptureBatch({
        language: scenario.language,
        notes: scenario.flow.notes.map((transcript) => ({ publicId: randomUUID(), transcript })),
      });
      cards = prepared.batch.candidates;
    }
    const issues = scenario.check(cards);
    const afterItems = storedItemCount(context);
    if (afterItems !== beforeItems) issues.push(`evaluation wrote Library items: ${beforeItems} -> ${afterItems}`);
    return {
      id: scenario.id,
      name: scenario.name,
      passed: issues.length === 0,
      issues,
      cards,
      tutorReplies,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: scenario.id,
      name: scenario.name,
      passed: false,
      issues: [],
      cards: [],
      tutorReplies,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    context.close();
  }
};

const results: ScenarioResult[] = new Array(scenarios.length);
let nextIndex = 0;
const worker = async () => {
  while (nextIndex < scenarios.length) {
    const index = nextIndex;
    nextIndex += 1;
    const scenario = scenarios[index];
    process.stdout.write(`RUN  ${scenario.id} ${scenario.name}\n`);
    const result = await runScenario(scenario);
    results[index] = result;
    process.stdout.write(`${result.passed ? "PASS" : "FAIL"} ${result.id} ${result.name} (${result.cards.length} cards, ${result.durationMs} ms)\n`);
  }
};

await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, () => worker()));

const failures = results.filter((result) => !result.passed);
for (const failure of failures) {
  console.log(JSON.stringify({
    id: failure.id,
    name: failure.name,
    error: failure.error,
    issues: failure.issues,
    tutorReplies: failure.tutorReplies,
    cards: failure.cards.map((card) => ({
      cue: card.cue,
      target: card.target,
      category: card.category,
      disposition: card.disposition,
      focusTerms: card.focusTerms,
    })),
  }, null, 2));
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  checkedAt: new Date().toISOString(),
  applied: false,
  models: { tutor: config.tutorModel, material: config.balancedModel },
  scenarios: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
}, null, 2));

if (failures.length) process.exitCode = 1;
