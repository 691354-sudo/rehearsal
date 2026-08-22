import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode } from "../types.js";
import { aiLimits, recentMessagesWithinBudget } from "./ai-limits.js";
import type { LearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { targetLanguageName } from "./material-generation.js";

const tutorLanguageGuidance: Record<LanguageCode, string> = {
  en: "Use natural contemporary English.",
  lv: "Use natural contemporary Latvian.",
  vi: "Use neutral contemporary standard Vietnamese and avoid strongly regional wording unless requested.",
  no: "Use natural contemporary Norwegian Bokmål and avoid dialect-specific or Nynorsk forms unless requested.",
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

export const tutorInstructions = (learner: LearnerPersona, language: LanguageCode) => `
You are ${learner.name}'s personal ${targetLanguageName(language)} tutor inside a private learning system.
${learner.context}
${tutorLanguageGuidance[language]}

Your job is to help the learner speak naturally and automatically, not to teach theory for its own sake.
- Chat as comfortably and intelligently as a normal ChatGPT conversation.
- Match the learner's known speaking style without inventing personal details. Prefer common native-like wording, phrasal verbs, and reusable sentence patterns.
- Correct collocations and sentence structure first.
- Explain briefly in Russian unless the learner asks for immersion.
- Build language islands: connected lines, short monologues, questions, and answers grounded in the conversation.
- Offer different natural ways to express one thought and different contexts for one phrase.
- Search the learner's library when prior phrases or mistakes are relevant.
- Never save phrases, corrections, or islands during normal conversation. Nothing enters the library without ${learner.name} selecting it in Finish & review.
- Use read-only tools for database facts. Never invent a database result or imply that you changed the library.
- Do not interrupt the flow to correct every sentence unless the learner explicitly asks for live correction. Keep useful observations for the end-of-chat review.
- Keep the initial answer concise, then deepen when the learner wants it.
`;

type TutorRepositories = Pick<RehearsalRepository, "items" | "practice" | "tutor">;

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
  ) {
    this.client = openaiService.configured ? new OpenAI({ apiKey: config.openaiApiKey }) : null;
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
      this.repository.tutor.getMessages(thread.id, 30),
      aiLimits.tutorHistoryCharacters,
    );
    const model = config.tutorModel;
    const modelInput: OpenAI.Responses.ResponseInput = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const toolCalls: Array<{ name: string; result: unknown }> = [];

    let response = await this.client.responses.create({
      model,
      reasoning: { effort: "low" },
      instructions: tutorInstructions(this.openaiService.learner, input.language),
      input: modelInput,
      tools,
      parallel_tool_calls: false,
      max_output_tokens: aiLimits.tutorOutputTokens,
    });

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
      response = await this.client.responses.create({
        model,
        reasoning: { effort: "low" },
        instructions: tutorInstructions(this.openaiService.learner, input.language),
        input: modelInput,
        tools,
        parallel_tool_calls: false,
        max_output_tokens: aiLimits.tutorOutputTokens,
      });
    }

    const content = response.output_text.trim() || "Done.";
    this.repository.tutor.addMessage(thread.id, "assistant", content, {
      clientMessageId: input.clientMessageId,
      mode: "openai",
      responseId: response.id,
      model,
      toolCalls: toolCalls.map((call) => call.name),
    });
    return { threadId: thread.publicId, content, mode: "openai" as const, toolCalls };
  }

  async review(threadPublicId: string) {
    const thread = this.repository.tutor.getThread(threadPublicId);
    if (!thread) return null;
    const messages = this.repository.tutor.getMessages(thread.id, 100);
    return this.openaiService.reviewConversation({
      language: thread.language_code,
      threadPublicId,
      messages,
    });
  }

  private async executeTool(name: string, rawArguments: string, language: LanguageCode) {
    const args: unknown = JSON.parse(rawArguments);
    if (name === "search_library") {
      const parsed = searchArguments.parse(args);
      const embedding = await this.openaiService.embed(parsed.query);
      return this.repository.items.search(parsed.query, language, embedding || undefined, parsed.limit);
    }
    if (name === "list_due_items") {
      const parsed = dueArguments.parse(args);
      return this.repository.practice.listDue(language, parsed.limit);
    }
    return { error: `Unknown tool: ${name}` };
  }
}
