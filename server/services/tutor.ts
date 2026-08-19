import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import { getModelRouting } from "../model-routing.js";
import type { LanguageCode } from "../types.js";
import type { OpenAIService } from "./openai.js";

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

const tutorInstructions = (language: LanguageCode) => `
You are Roman's personal ${language === "en" ? "English" : "Latvian"} tutor inside his private learning system.

Your job is to help him speak naturally and automatically, not to teach theory for its own sake.
- Chat as comfortably and intelligently as a normal ChatGPT conversation.
- Match his casual, direct speaking style. Prefer common native-like wording, phrasal verbs, and reusable sentence patterns.
- Correct collocations and sentence structure first; those are his current bottlenecks.
- Explain briefly in Russian unless he asks for immersion.
- Build language islands: connected lines, short monologues, questions, and answers about his real life.
- Offer different natural ways to express one thought and different contexts for one phrase.
- Search his library when prior phrases or mistakes are relevant.
- Never save phrases, corrections, or islands during normal conversation. Nothing enters the library without Roman selecting it in Finish & review.
- Use read-only tools for database facts. Never invent a database result or imply that you changed the library.
- Do not interrupt the flow to correct every sentence unless Roman explicitly asks for live correction. Keep useful observations for the end-of-chat review.
- Keep the initial answer concise, then deepen when Roman wants it.
`;

export class TutorService {
  private readonly client: OpenAI | null;

  constructor(
    private readonly repository: RehearsalRepository,
    private readonly openaiService: OpenAIService,
  ) {
    this.client = openaiService.configured ? new OpenAI({ apiKey: config.openaiApiKey }) : null;
  }

  async chat(input: { language: LanguageCode; message: string; threadPublicId?: string }) {
    const thread = this.repository.getOrCreateThread(input.threadPublicId, input.language);
    this.repository.addMessage(thread.id, "user", input.message);
    this.repository.ensureThreadTitle(thread.id, input.message);

    if (!this.client) {
      const content =
        "The backend and database are ready, but OpenAI is not connected yet. Add OPENAI_API_KEY to .env and restart the app to enable Tutor replies and read-only Library search.";
      this.repository.addMessage(thread.id, "assistant", content, { mode: "setup" });
      return { threadId: thread.publicId, content, mode: "setup" as const, toolCalls: [] };
    }

    const history = this.repository.getMessages(thread.id, 30);
    const model = getModelRouting().tutor;
    const modelInput: OpenAI.Responses.ResponseInput = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const toolCalls: Array<{ name: string; result: unknown }> = [];

    let response = await this.client.responses.create({
      model,
      reasoning: { effort: "low" },
      instructions: tutorInstructions(input.language),
      input: modelInput,
      tools,
      parallel_tool_calls: false,
    });

    for (let round = 0; round < 4; round += 1) {
      const calls = response.output.filter((item) => item.type === "function_call");
      if (!calls.length) break;
      modelInput.push(...(response.output as unknown as OpenAI.Responses.ResponseInput));
      for (const call of calls) {
        const result = await this.executeTool(call.name, call.arguments, input.language);
        toolCalls.push({ name: call.name, result });
        this.repository.addMessage(thread.id, "tool", JSON.stringify(result), { name: call.name });
        modelInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      response = await this.client.responses.create({
        model,
        reasoning: { effort: "low" },
        instructions: tutorInstructions(input.language),
        input: modelInput,
        tools,
        parallel_tool_calls: false,
      });
    }

    const content = response.output_text.trim() || "Done.";
    this.repository.addMessage(thread.id, "assistant", content, {
      responseId: response.id,
      model,
      toolCalls: toolCalls.map((call) => call.name),
    });
    return { threadId: thread.publicId, content, mode: "openai" as const, toolCalls };
  }

  async review(threadPublicId: string) {
    const thread = this.repository.getThread(threadPublicId);
    if (!thread) return null;
    const messages = this.repository.getMessages(thread.id, 100);
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
      return this.repository.search(parsed.query, language, embedding || undefined, parsed.limit);
    }
    if (name === "list_due_items") {
      const parsed = dueArguments.parse(args);
      return this.repository.listDueItems(language, parsed.limit);
    }
    return { error: `Unknown tool: ${name}` };
  }
}
