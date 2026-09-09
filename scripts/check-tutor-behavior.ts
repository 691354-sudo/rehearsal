import fs from "node:fs";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { config, openAIConfigured } from "../server/config.js";
import { OpenAIService } from "../server/services/openai.js";
import { TutorService } from "../server/services/tutor.js";
import { createApiTestContext } from "../server/testing/api-test-context.js";
import { guidedPracticeReviewMessages, isGuidedPracticeStartMessage } from "../contracts/tutor-guided-practice.js";
import { tutorBehaviorScenarios } from "./tutor-behavior-scenarios.js";

if (process.env.CONFIRM_PROMPT_EVAL !== "1") throw new Error("Set CONFIRM_PROMPT_EVAL=1 to authorize paid synthetic Tutor evaluations.");
if (!openAIConfigured) throw new Error("OPENAI_API_KEY is required.");
const selected = (process.env.TUTOR_EVAL_SCENARIOS || "").split(",").filter(Boolean);
const scenarios = selected.length ? tutorBehaviorScenarios.filter((entry) => selected.includes(entry.id)) : tutorBehaviorScenarios;
if (selected.some((id) => !scenarios.some((entry) => entry.id === id))) throw new Error("Unknown Tutor scenario.");
if (process.env.TUTOR_EVAL_MODEL && config.tutorModel !== process.env.TUTOR_EVAL_MODEL) throw new Error(`Expected ${process.env.TUTOR_EVAL_MODEL}, configured ${config.tutorModel}`);
console.log(`Tutor evaluation model: ${config.tutorModel}`);
const client = new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 0, timeout: 60_000 });
const originalCreate = client.responses.create.bind(client.responses);
let providerRequests = 0;
const requestLimit = Math.min(80, Math.max(1, Number(process.env.TUTOR_EVAL_REQUEST_LIMIT) || 60));
const usage = { inputTokens: 0, outputTokens: 0 };
client.responses.create = (async (...args: Parameters<typeof originalCreate>) => {
  if (++providerRequests > requestLimit) throw new Error("Tutor evaluation request limit reached.");
  const response = await originalCreate(...args);
  if ("usage" in response && response.usage) {
    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
  }
  return response;
}) as typeof client.responses.create;
const results: unknown[] = [];
let failures = 0;
for (const scenario of scenarios) {
  const context = createApiTestContext();
  const language = scenario.language || "en";
  const replies: Array<{ content: string; toolCalls: unknown[] }> = [];
  const issues: string[] = [];
  try {
    const before = JSON.stringify(context.repository.system.stats());
    if (scenario.seedFocus) {
      const source = context.repository.tutor.getOrCreateThread(undefined, language);
      for (const quote of ["Yesterday I go home.", "Last week I go to a cafe."]) {
        const id = context.repository.tutor.addMessage(source.id, "user", quote);
        context.repository.tutor.learningFocus.record(language, id, { key: "past-simple", title: "Past simple", detail: "Use past forms for finished events.", quote });
      }
    }
    const hw = scenario.homework ? (() => {
      const topic = context.repository.library.createIsland({ language: "en", title: "Synthetic Homework" });
      const card = context.repository.items.create({ language: "en", cue: "Я справлюсь.", target: "I can pull through." }, topic.publicId);
      context.repository.pilot.listening.like({ eventId: randomUUID(), language: "en", cardId: card.publicId, liked: true, occurredAt: new Date().toISOString() });
      return context.repository.pilot.homework.create({ homeworkId: randomUUID(), requestedMinutes: 5, timezone: "Europe/Riga" });
    })() : undefined;
    const thread = context.repository.tutor.getOrCreateThread(hw?.tutorChatId, language);
    for (const entry of scenario.history || []) {
      const id = context.repository.tutor.addMessage(thread.id, entry.role, entry.content);
      if (entry.role === "user" && isGuidedPracticeStartMessage(entry.content)) context.repository.tutor.setMode(thread.id, id, "guided", true);
    }
    const openai = new OpenAIService(context.repository);
    openai.embed = async () => null;
    const tutor = new TutorService(context.repository, openai, false, client);
    for (const message of scenario.turns) {
      const reply = await tutor.chat({ language, message, threadPublicId: thread.publicId, clientMessageId: randomUUID(),
        ...(hw ? { homeworkId: hw.homeworkId, homeworkPlanning: replies.length === 0 } : {}) });
      replies.push({ content: reply.content, toolCalls: reply.toolCalls });
    }
    const history = context.repository.tutor.getMessages(thread.id, 100);
    const mode = hw ? "homework" : context.repository.tutor.getMode(thread.id)?.mode || (guidedPracticeReviewMessages(history) ? "guided" : "chat");
    if (mode !== scenario.mode) issues.push(`Expected ${scenario.mode}, received ${mode}`);
    if (scenario.mode === "chat" && /^\s*#{1,3}\s*(Feedback|Next Task)\s*$/im.test(replies.at(-1)?.content || "")) issues.push("Exercise headings leaked into ordinary chat.");
    if (scenario.expectedTool && !replies.some((reply) => reply.toolCalls.some((call) => (call as { name: string }).name === scenario.expectedTool))) issues.push(`Missing tool ${scenario.expectedTool}`);
    if (!hw && JSON.stringify(context.repository.system.stats()) !== before) issues.push("Unexpected Library or schedule mutation.");
    const focus = context.repository.tutor.learningFocus.list(language);
    if (scenario.id === "recurring-focus" && !focus.some((entry) => entry.occurrences >= 2)) issues.push("Recurring gap was not saved from distinct learner messages.");
    if (scenario.id === "focus-list-delete" && focus.length) issues.push("Requested learning topic was not deleted.");
    if (["quoted-instructions", "valid-variation"].includes(scenario.id) && context.repository.tutor.learningFocus.list(language, true).length) issues.push("Invalid learner-error evidence was recorded.");
    results.push({ id: scenario.id, issues, manualCriterion: scenario.check, history: scenario.history, turns: scenario.turns, replies, focus });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    results.push({ id: scenario.id, issues, replies });
  } finally { context.close(); }
  if (issues.length) failures++;
  console.log(`${issues.length ? "FAIL" : "CHECK"} ${scenario.id}${issues.length ? `: ${issues.join("; ")}` : " — inspect response quality"}`);
  if (providerRequests >= requestLimit) break;
}
const report = { checkedAt: new Date().toISOString(), model: config.tutorModel, appliedToProfiles: false,
  providerRequests, usage, scenarios: results.length, automatedFailures: failures, manualReviewRequired: true, results };
fs.writeFileSync(process.env.TUTOR_EVAL_REPORT || "/private/tmp/tutor-behavior-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }));
if (failures || results.length !== scenarios.length) process.exitCode = 1;
