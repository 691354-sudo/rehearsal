import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode } from "../types.js";
import {
  comparableGuidedPracticeTarget,
  guidedPracticeReviewMessages,
} from "../../contracts/tutor-guided-practice.js";
import { aiLimits, recentMessagesWithinBudget } from "./ai-limits.js";
import { responseTokenUsage, trackAiRequest } from "./ai-usage.js";
import type { LearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { targetLanguageName } from "./material-generation.js";

const tutorLanguageGuidance: Record<LanguageCode, string> = {
  en: "Use natural contemporary English.",
  lv: "Use natural contemporary Latvian.",
  vi: "Use neutral contemporary standard Vietnamese and avoid strongly regional wording unless requested.",
  no: "Use natural contemporary Norwegian Bokmål and avoid dialect-specific or Nynorsk forms unless requested.",
  id: "Use natural contemporary standard Indonesian. Prefer broadly understood informal-neutral wording and avoid region-specific slang or Malay forms unless requested.",
};

const searchArguments = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20) });
const dueArguments = z.object({ limit: z.number().int().min(1).max(30) });

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "search_library",
    description: "Search the student's own phrases, corrections, and island lines by wording or meaning.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to find in the student's library." },
        limit: { type: "number", description: "Number of results, from 1 to 20." },
      },
      required: ["query", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_due_items",
    description: "List phrases currently due for practice in the active language.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Number of due phrases, from 1 to 30." } },
      required: ["limit"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const echoProductGuide = `

Echo product guide (closed onboarding pilot only):
- If the learner asks how Echo works, where something is, or what to do next, answer briefly in Russian and give one clear next action. Do not interrupt ordinary language practice with unsolicited product tips.
- Tutor is for questions, explanations, role-play, and conversation. Finish & make cards prepares a review; nothing is saved until the learner selects cards.
- Notebook is for Russian thoughts, answers, questions, and dialogues, typed or recorded. Prepare cards creates a review; the learner checks every card before saving.
- Library contains saved cards grouped by Topics. Cards can be found, edited, moved, or removed.
- Practice has Listen & Repeat for choosing a voice, listening, speaking aloud, and repeating the whole deck or one phrase. Recall asks the learner to reproduce the phrase without the target-language answer visible; Latvian Recall uses a Russian cue and a typed Latvian answer before speaking the checked phrase aloud.
- Settings can reopen How Echo works. Theme can be changed with the light/dark control. Never claim a screen, button, or capability that is not listed here.
`;

export const tutorInstructions = (learner: LearnerPersona, language: LanguageCode, includeEchoProductGuide = false) => `
You are ${learner.name}'s personal ${targetLanguageName(language)} tutor inside a private learning system.
${learner.context}
${tutorLanguageGuidance[language]}
${includeEchoProductGuide ? echoProductGuide : ""}

Your job is to help the learner speak naturally and automatically, not to teach theory for its own sake.
- Chat as comfortably and intelligently as a normal ChatGPT conversation.
- Match the learner's known speaking style without inventing personal details. Prefer common native-like wording, phrasal verbs, and reusable sentence patterns.
- Correct collocations and sentence structure first.
- Explain briefly in Russian unless the learner asks for immersion.
- Build language islands: connected lines, short monologues, questions, and answers grounded in the conversation.
- Offer different natural ways to express one thought and different contexts for one phrase.
- Search the learner's library when prior phrases or mistakes are relevant.
- Never save phrases, corrections, or islands during normal conversation. Nothing enters the library without ${learner.name} selecting it in Finish & review.
- When ${learner.name} explicitly asks for card-ready material, follow the requested shape, quantity, and order. “One card for each” means one separate source unit per line, including every member of stated ranges or enumerations. Bare foundational units such as numbers or individual letters may stay atomic; do not add example sentences, merge units, or omit them just because ordinary learning cards prefer contextual utterances.
- Use read-only tools for database facts. Never invent a database result or imply that you changed the library.
- When the learner asks to start a guided practice session, call list_due_items with a limit of 5 before choosing. If it returns useful material, usually run Recall & reuse; if it is empty, run Tell it better. Give the exercise name briefly and one immediate action, not a lesson plan or explanation.
- When the learner asks to choose a guided exercise, offer exactly these three terse choices and wait: Tell it better, Recall & reuse, and Role-play twice.
- Guided practice has four recipes:
  1. Tell it better: ask for one real thought; focus on at most two high-value gaps; ask for self-repair before revealing a natural reformulation; have the learner reproduce the whole thought and then reuse the trained chunk in a different context.
  2. Recall & reuse: use 3–5 due or relevant Library items; show only their Russian cues or situations before recall, never the target answers; then ask the learner to use one or two chunks in a new response. Never grade or reschedule them.
  3. Role-play twice: run one short real-life scene, give focused feedback, then repeat the same scene with one changed variable.
  4. Read → retell: use this only when the learner supplied a substantial text; ask for a retell without looking, give focused feedback and 2–3 useful expressions, then ask for one improved retell. Never call a short Tutor-generated passage extensive reading.
- When the learner supplies a substantial text and asks to practise it or asks Tutor to choose, begin Read → retell instead of generating another passage.
- In guided practice, give one next action at a time, keep the same topic, and use no more than three training rounds. Speaking and typing are equivalent paths. Do not add timers, scores, streaks, pronunciation ratings, or accent ratings.
- Guided correction differs from ordinary live correction: first point to the gap without giving the answer and ask the learner to reformulate it. Reveal one natural answer only if the learner needs it, then require the whole thought again. Do not use the Correction block until after that self-repair attempt.
- Do not interrupt the flow to correct every sentence unless the learner explicitly asks for live correction. Keep useful observations for the end-of-chat review.
- When live correction is appropriate, keep the conversation moving and use this exact Markdown structure, with blank lines between each part. The conversational reply before the heading is mandatory. After the heading, output exactly the three shown blocks: no alternatives, labels, or bullet lists.
  <one short conversational reply>

  ### Correction

  <the learner's original sentence>

  **<one natural corrected sentence>**

  <one brief explanation; no bullet list>
- Keep the initial answer concise, then deepen when the learner wants it.
`;

type TutorRepositories = Pick<RehearsalRepository, "aiUsage" | "items" | "practice" | "reviews" | "tutor">;

export class TutorService {
  private readonly client: OpenAI | null;
  private readonly inFlight = new Map<string, Promise<{
    threadId: string;
    content: string;
    mode: "setup" | "openai";
    toolCalls: Array<{ name: string; result: unknown }>;
  }>>();

  constructor(
    private readonly repository: TutorRepositories,
    private readonly openaiService: OpenAIService,
    private readonly includeEchoProductGuide = false,
    client?: OpenAI | null,
  ) {
    this.client = client === undefined
      ? openaiService.configured ? new OpenAI({ apiKey: config.openaiApiKey }) : null
      : client;
  }

  async chat(input: { language: LanguageCode; message: string; threadPublicId?: string; clientMessageId: string }) {
    const message = this.repository.tutor.getOrCreateClientMessage({
      clientMessageId: input.clientMessageId,
      content: input.message,
      language: input.language,
      threadPublicId: input.threadPublicId,
    });
    const completed = this.repository.tutor.getCompletedClientExchange(input.clientMessageId);
    if (completed) return completed;
    const running = this.inFlight.get(input.clientMessageId);
    if (running) return running;
    const request = this.createReply(input, { id: message.thread_id, publicId: message.thread_public_id });
    this.inFlight.set(input.clientMessageId, request);
    try { return await request; }
    finally { this.inFlight.delete(input.clientMessageId); }
  }

  private async createReply(
    input: { language: LanguageCode; message: string; clientMessageId: string },
    thread: { id: number; publicId: string },
  ) {

    if (!this.client) {
      const content =
        "The backend and database are ready, but OpenAI is not connected yet. Add OPENAI_API_KEY to .env and restart the app to enable Tutor replies and read-only Library search.";
      this.repository.tutor.addMessage(thread.id, "assistant", content, {
        clientMessageId: input.clientMessageId, mode: "setup",
      });
      return { threadId: thread.publicId, content, mode: "setup" as const, toolCalls: [] };
    }

    const history = recentMessagesWithinBudget(
      this.repository.tutor.getMessages(thread.id, aiLimits.tutorHistoryMessages),
      aiLimits.tutorHistoryCharacters,
    );
    const model = config.tutorModel;
    const modelInput: OpenAI.Responses.ResponseInput = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const toolCalls: Array<{ name: string; result: unknown }> = [];
    const instructions = tutorInstructions(this.openaiService.learner, input.language, this.includeEchoProductGuide);
    const usage = {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    };
    const createResponse = async () => {
      const next = await trackAiRequest({
        repository: this.repository.aiUsage, provider: "openai", workload: "tutor_chat", model,
        language: input.language,
        operationId: input.clientMessageId,
        inputCharacters: instructions.length + JSON.stringify(modelInput).length,
        measure: responseTokenUsage,
      }, () => this.client!.responses.create({
        model,
        reasoning: { effort: "low" },
        instructions,
        input: modelInput,
        tools,
        parallel_tool_calls: false,
        max_output_tokens: aiLimits.tutorOutputTokens,
        prompt_cache_key: `tutor:${thread.publicId}`,
      }));
      usage.requests += 1;
      if (next.usage) {
        usage.inputTokens += next.usage.input_tokens;
        usage.cachedInputTokens += next.usage.input_tokens_details.cached_tokens;
        usage.cacheWriteTokens += next.usage.input_tokens_details.cache_write_tokens;
        usage.outputTokens += next.usage.output_tokens;
        usage.reasoningTokens += next.usage.output_tokens_details.reasoning_tokens;
        usage.totalTokens += next.usage.total_tokens;
      }
      return next;
    };

    let response = await createResponse();

    for (let round = 0; round < 4; round += 1) {
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) break;
      modelInput.push(...(response.output as unknown as OpenAI.Responses.ResponseInput));
      for (const call of calls) {
        const result = await this.executeTool(call.name, call.arguments, input.language);
        toolCalls.push({ name: call.name, result });
        this.repository.tutor.addMessage(thread.id, "tool", JSON.stringify(result), { name: call.name });
        modelInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      response = await createResponse();
    }

    const content = response.output_text.trim() || "Done.";
    const context = {
      historyMessages: history.length,
      historyCharacters: history.reduce((characters, message) => characters + message.content.length, 0),
    };
    this.repository.tutor.addMessage(thread.id, "assistant", content, {
      clientMessageId: input.clientMessageId,
      mode: "openai",
      responseId: response.id,
      model,
      toolCalls: toolCalls.map((call) => call.name),
      usage,
      context,
    });
    console.info(JSON.stringify({ event: "tutor_openai_usage", model, threadId: thread.publicId, usage, context }));
    return { threadId: thread.publicId, content, mode: "openai" as const, toolCalls };
  }

  async review(threadPublicId: string, batchPublicId?: string) {
    const thread = this.repository.tutor.getThread(threadPublicId);
    if (!thread) return null;
    const messages = this.repository.tutor.getMessages(thread.id, 100);
    const guidedMessages = guidedPracticeReviewMessages(messages);
    const result = await this.openaiService.reviewConversation({
      publicId: batchPublicId,
      language: thread.language_code,
      threadPublicId,
      messages: guidedMessages || messages,
      guidedPractice: Boolean(guidedMessages),
    });
    if (!guidedMessages) return result;
    const libraryTargets = new Set(this.repository.items.list(thread.language_code, 5_000)
      .map((item) => comparableGuidedPracticeTarget(item.target)));
    const candidates = result.batch.candidates
      .filter((candidate) => !libraryTargets.has(comparableGuidedPracticeTarget(candidate.target)))
      .slice(0, 3);
    if (candidates.length === result.batch.candidates.length) return result;
    const batch = this.repository.reviews.replaceGeneratedCandidates(result.batch.publicId, candidates);
    return batch ? { ...result, batch } : result;
  }

  private async executeTool(name: string, rawArguments: string, language: LanguageCode) {
    const args: unknown = JSON.parse(rawArguments);
    if (name === "search_library") {
      const parsed = searchArguments.parse(args);
      const embedding = await this.openaiService.embed(parsed.query, language);
      return this.repository.items.search(parsed.query, language, embedding || undefined, parsed.limit);
    }
    if (name === "list_due_items") {
      const parsed = dueArguments.parse(args);
      return this.repository.practice.listDue(language, parsed.limit);
    }
    return { error: `Unknown tool: ${name}` };
  }
}
