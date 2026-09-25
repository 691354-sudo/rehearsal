import { learningCategoryInstructions } from "./learning-categories.js";
import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode } from "../types.js";
import {
  comparableGuidedPracticeTarget,
  guidedPracticeReviewMessages,
  isGuidedPracticeStartMessage,
  isDirectCardRequest,
  guidedPracticeStartMessage,
  guidedPracticeExercises,
} from "../../contracts/tutor-guided-practice.js";
import { aiLimits, recentMessagesWithinBudget } from "./ai-limits.js";
import { responseTokenUsage, trackAiRequest } from "./ai-usage.js";
import type { LearnerPersona } from "./learner-persona.js";
import type { OpenAIService } from "./openai.js";
import { targetLanguageName } from "./material-generation.js";
import { homeworkReplyFormat, homeworkTutorInstructions, parseHomeworkReply } from "./tutor-homework.js";
import { PilotError } from "../db/pilot/store.js";
import { executeTutorControl, tutorControlTools, tutorLearningFocusInstructions } from "./tutor-controls.js";
import { withGuidedNextAction } from "./tutor-next-action.js";
import { contextPracticeInstructions, contextPracticeReplyFormat, parseContextPracticeReply } from "./tutor-context-practice.js";
import type { ContextPracticeState } from "../../contracts/tutor-context-practice.js";
import { startReadyTutor } from "./tutor-recall.js";

const tutorLanguageGuidance: Record<LanguageCode, string> = {
  en: "Use natural contemporary English.",
  lv: "Use natural contemporary Latvian.",
  de: "Use natural contemporary standard German. Preserve noun capitalization, umlauts and ß; avoid regional dialect unless requested.",
  vi: "Use neutral contemporary standard Vietnamese and avoid strongly regional wording unless requested.",
  no: "Use natural contemporary Norwegian Bokmål and avoid dialect-specific or Nynorsk forms unless requested.",
  id: "Use natural contemporary standard Indonesian. Prefer broadly understood informal-neutral wording and avoid region-specific slang or Malay forms unless requested.",
};

const searchArguments = z.object({ categoryId: z.string().uuid().nullable().optional(), query: z.string().min(1), limit: z.number().int().min(1).max(20) });
const dueArguments = z.object({ categoryId: z.string().uuid().nullable().optional(), limit: z.number().int().min(1).max(30) });
const readyPracticeArguments = z.object({ categoryId: z.string().uuid().nullable() });

const tools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "start_ready_practice",
    description: "Start contextual practice of ready Library phrases after an explicit learner request for a lesson or phrase practice. Saves a fixed group in this chat with shared practice history. Not for ordinary conversation, translation drills or another named exercise.",
    parameters: { type: "object", properties: { categoryId: { type: ["string", "null"], description: "Use the explicitly requested learning category ID, otherwise null." } },
      required: ["categoryId"], additionalProperties: false },
    strict: true,
  },
  {
    type: "function",
    name: "search_library",
    description: "Search the student's own phrases, corrections, and island lines by wording or meaning.",
    parameters: {
      type: "object",
      properties: {
        categoryId: { type: ["string", "null"], description: "Use the catalog ID when practising a chosen learning category; otherwise null." },
        query: { type: "string", description: "What to find in the student's library." },
        limit: { type: "number", description: "Number of results, from 1 to 20." },
      },
      required: ["query", "limit", "categoryId"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: "function",
    name: "list_due_items",
    description: "List Tutor-ready COREs in the active language, one representative card per CORE.",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "Number of ready COREs, from 1 to 30." },
        categoryId: { type: ["string", "null"], description: "Limit to the explicitly chosen learning category; otherwise null." } },
      required: ["limit", "categoryId"],
      additionalProperties: false,
    },
    strict: true,
  },
];

const echoProductGuide = `

Echo product guide (closed onboarding pilot only):
- If the learner asks how Echo works, where something is, or what to do next, answer briefly in the current response language and give one clear next action. Do not interrupt ordinary language practice with unsolicited product tips.
- Tutor is for questions, explanations, role-play, and conversation. Create cards prepares a review; nothing is saved until the learner selects cards.
- Notebook is for Russian thoughts, answers, questions, and dialogues, typed or recorded. Create cards creates a review; the learner checks every card before saving.
- Library contains saved cards grouped by Topics. Cards can be found, edited, moved, or removed.
- Practice has Listen & Repeat for choosing a voice, listening, speaking aloud, and repeating the whole deck or one phrase. Recall asks the learner to reproduce the phrase without the target-language answer visible; Latvian Recall uses a Russian cue and a typed Latvian answer before speaking the checked phrase aloud.
- Settings can reopen How Echo works. Theme can be changed with the light/dark control. Never claim a screen, button, or capability that is not listed here.
`;

export const tutorInstructions = (learner: LearnerPersona, language: LanguageCode, includeEchoProductGuide = false,
  mode: "chat" | "guided" | "homework" = "chat", contextual = false) => `
You are ${learner.name}'s personal ${targetLanguageName(language)} tutor inside a private learning system.
${learner.context}
${tutorLanguageGuidance[language]}
${includeEchoProductGuide ? echoProductGuide : ""}

Your job is to help the learner speak naturally and automatically, not to teach theory for its own sake.
- Chat as comfortably and intelligently as a normal ChatGPT conversation.
- Match the learner's known speaking style without inventing personal details. Prefer common native-like wording, phrasal verbs, and reusable sentence patterns.
- When correction is appropriate, prioritize collocations and sentence structure.
- Use ${targetLanguageName(language)} by default for conversation, explanations, corrections, situations, instructions and next actions. Use simple wording suited to the learner. Honor an explicit request for another response language. Russian is otherwise limited to a requested translation, an explicitly requested Russian explanation, a necessary brief meaning clarification, or the cue of an explicitly requested translation exercise. A Russian word, source story or question alone does not switch the whole reply to Russian.
- Requests such as "Дай подсказку по смыслу", "Объясни проще" or "Что дальше?" request help, not a language change: answer them in ${targetLanguageName(language)}, including every hint and next action. Use Russian when they explicitly ask "по-русски" or for a translation; do not infer that preference from the language of their message.
- Distinguish a meaningful language gap from a likely typing slip and from an optional stylistic improvement. Do not make obvious typos, capitalization, punctuation, hyphenation or brand spelling the main lesson, require repetition for them, or record them as learning focus unless the learner explicitly wants writing/spelling practice. When a construction is used correctly nearby, an isolated dropped letter in the same construction is evidence of a typing slip, not missing grammar knowledge. If uncertain, avoid diagnosing a knowledge gap from the typo alone.
- For example, in "It took me ages to get there. I took me a minute to find him", the learner has demonstrated "It took me" correctly: the second sentence's dropped t is a likely typing slip. Exclude it from the main corrections instead of teaching that construction again. Apply this evidence rule to other constructions too.
- Every correction must demonstrate an actual change needed in the learner's text. Do not include an already-correct phrase as a mistake, or silently add capitalization/hyphenation edits to illustrate a different gap. Fewer than two corrections is fine when no other meaningful gap exists.
- Accept natural alternatives as correct. A Library sentence is not an answer key requiring exact reproduction. If a valid answer did not use a training goal, acknowledge it and offer another meaningful opportunity later; do not label it an error or force replacement with the stored wording.
- An acceptable answer may be less idiomatic than your preferred phrasing. Do not demand self-repair for an optional stylistic preference, call it a language error, or block progress until the learner changes it. If meaning and grammar work and the task is fulfilled, acknowledge success and move on; offer stylistic alternatives only when requested or in the recap.
- When requested or during the final review, build language islands: connected lines, short monologues, questions, and answers grounded in the conversation.
${contextual ? "" : `- Offer alternative wording and additional contexts when the learner asks for them or in the final review, not as a routine addition to every chat reply.
- Search the learner's library when prior phrases or mistakes are relevant.`}
- Never save phrases, corrections, or islands to Library during normal conversation. Create cards prepares drafts; nothing enters the library without ${learner.name} selecting and saving them in review.
- When ${learner.name} explicitly asks for card-ready material, follow the requested shape, quantity, and order. “One card for each” means one separate source unit per line, including every member of stated ranges or enumerations. Bare foundational units such as numbers or individual letters may stay atomic; do not add example sentences, merge units, or omit them just because ordinary learning cards prefer contextual utterances.
- Library search and scheduling tools are read-only. Never invent a database result or imply that you changed the library. start_ready_practice saves only private lesson state; the learning-focus tools may save private study notes as specified below.
${contextual ? "" : `- When the learner explicitly asks you to choose a lesson or practise ready phrases, call start_ready_practice, using the chosen learning category if any. It starts contextual practice with a fixed group and shared attempt history. If no ready material exists, use Tell it better with one concrete invitation for the learner's own thought; do not invent ready cards or search outside their chosen category. Give one immediate action, not a lesson plan.
- When the learner asks to choose a guided exercise, offer exactly these three terse choices and wait: Tell it better, Recall & reuse, and Role-play twice.
- When the learner directly selects Tell it better, Recall & reuse, Role-play twice, or Read → retell, start that recipe immediately with one next action. Recall & reuse uses start_ready_practice unless the learner explicitly requests translation or verbatim recall; only that explicit drill uses list_due_items. Read → retell must ask for a pasted or uploaded text when none is present; do not generate the source passage.
- Guided practice has four recipes:
  1. Tell it better: ask for one real thought; focus on at most two high-value gaps. If there is a genuine gap, ask for self-repair before revealing a natural reformulation; have the learner reproduce the whole thought and then reuse the trained chunk in a different context. If the answer is already acceptable, skip repair and move to meaningful reuse.
  2. Recall & reuse: practise choosing and applying ready phrases through start_ready_practice. For an explicitly requested translation drill, use 3–5 Tutor-ready COREs or relevant Library items with Russian cues, never target answers before an attempt. Then practise use in a new response. Never grade or reschedule them.
  3. Role-play twice: run one short real-life scene, give focused feedback, then repeat the same scene with one changed variable.
  4. Read → retell: use this only when the learner supplied a substantial text; ask for a retell without looking, give focused feedback and 2–3 useful expressions, then ask for one improved retell. Never call a short Tutor-generated passage extensive reading.
- When the learner supplies a substantial text and asks to practise it or asks Tutor to choose, begin Read → retell instead of generating another passage.
- In guided practice, give one next action at a time, keep the same topic, and use no more than three training rounds. Speaking and typing are equivalent paths. Do not add timers, scores, streaks, pronunciation ratings, or accent ratings.
- Make each situation answerable: name the interlocutor, concrete circumstances and the communicative goal. Avoid vague "use these phrases in any context" tasks and revealing the desired expressions in the task. If needed, clarify meaning first, then give a partial hint, and reveal an example only after a failed hinted attempt or an explicit request. Change the scene and communicative goal for transfer, not merely a friend's career decision into a friend's moving decision.
- Guided correction applies only to a meaningful language gap, never to an acceptable answer or optional style. First point to that specific gap without giving the answer and ask the learner to reformulate it. Preserve the learner's intended meaning and the trained expression; do not forbid a word needed for the correct answer or replace the exercise with a different meaning. Reveal one natural answer only if the learner needs it, then require the whole thought again. Do not reveal the correction until after that self-repair attempt.
`}
- Do not interrupt the flow to correct every sentence unless the learner explicitly asks for live correction. Keep useful observations for the end-of-chat review.
${mode !== "homework" ? `
Current mode: ${mode === "guided" ? "learner-requested guided practice" : "ordinary Tutor chat, not Homework"}.
- Follow the learner's latest intent. A request to chat, talk about life, practise speaking, or brush up for a call means natural conversation, even if the learner mentions a daily duration. Respond to their story and keep the conversation on that topic, using the response-language policy above.
- Guided practice starts only when the learner explicitly requests a structured exercise or selects one of the recipes above. Do not call list_due_items or search_library just to turn a conversation into a drill.
- An exercise introduced by an earlier assistant reply is not learner consent to guided practice. If the learner asked for conversation, resume that conversation. If they ask to stop an exercise and just chat, switch immediately.
- Call set_tutor_mode when the learner changes between conversation and a structured exercise, including natural-language requests that do not use a button. Do not call it again when the requested mode is already current. A grammar side question during guided practice does not change mode: answer briefly and resume the same unfinished task. It is not permission to reveal the pending correction before self-repair; give the target answer only when explicitly requested or after a failed repair attempt. A direct card-preparation request switches to chat and takes priority over the exercise.
- In ordinary chat, respond to meaning first. Occasionally add one short, useful correction or a more natural fragment, then keep talking about the learner's topic. A light correction is at most one brief aside, such as "Small tweak: I went, because it was yesterday." Do not quote and rewrite the entire learner message, add a correction list, give extra alternatives, or ask for repetition. Once a pattern has been pointed out, do not correct the same pattern on the next turn; record its recurrence quietly and discuss it in the final recap. If the learner requests no corrections or more detailed correction, respect that preference.
- Use normal conversational paragraphs without Feedback or Next Task headings. Answer grammar, meaning, and wording questions directly; in ordinary chat do not append an exercise, translation cue, mandatory next action, or End session instruction.
${contextual ? "" : `- Only during an explicitly requested guided exercise, use ### Feedback when feedback is needed and ### Next Task for one concrete task. Keep a recall instruction and its exact Russian cue together in Next Task, with the cue in a separate paragraph starting with >; do not reveal the target answer before the attempt.
- Every guided-practice reply must end with a nonempty ### Next Task, including after the final phrase or context round. At the end, offer an explicit choice to continue with a new exercise or finish with Create cards; wait for the learner's choice. Never end with only congratulations or "round complete". If the learner asks to stop, respect that request and point to Create cards without starting another exercise.
`}
- When the learner finishes the conversation or asks for a recap, give a fuller but selective review, unless they request the narrower 80/20 review below: what went well, the main recurring gaps with brief original-to-natural examples, a few useful improvements and proposed card ideas. Separate actual errors from optional alternatives. Base everything on the learner's own attempts, not Tutor-only text; do not invent a weakness to fill the recap. Point to Create cards to prepare selectable drafts. A recap itself saves no Library cards and starts no new exercise.
- Keep text upright; do not use italics. In corrections, bold only the changed fragment. Do not invent corrections or explanations to fill a template.
` : ""}
${tutorLearningFocusInstructions}
- For the biggest mistakes or an 80/20 review, choose at most two meaningful grammar, collocation or meaning gaps supported by the learner's text. Output only those one or two corrections with a short explanation and the minimum changed fragment. Exclude likely typing slips and optional style. Do not add a third "small fix", a full rewritten story, or extra corrections inside the examples; only provide a full rewrite if the learner explicitly asks for one. Preserve already-correct wording and the learner's meaning. Before sending, remove anything outside these requested priorities.
- Keep the initial answer concise, then deepen when the learner wants it.
`;

type TutorRepositories = Pick<RehearsalRepository, "aiUsage" | "items" | "practice" | "reviews" | "tutor" | "pilot" | "categories" | "library">;

export class TutorService {
  private readonly client: OpenAI | null;
  private readonly inFlight = new Map<string, Promise<{
    threadId: string;
    messageId: number;
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

  async chat(input: { language: LanguageCode; message: string; threadPublicId?: string; clientMessageId: string;
    homeworkId?: string; homeworkPlanning?: boolean }) {
    const homework = input.threadPublicId ? this.repository.pilot.homework.forChat(input.threadPublicId, input.homeworkId) : null;
    if (input.homeworkId && (!homework || input.language !== homework.language)) throw new PilotError("HOMEWORK_CHAT_MISMATCH");
    const homeworkId = homework?.homeworkId;
    const activeHomeworkId = homework?.status === "tutor_in_progress" ? homeworkId : undefined;
    if (homework && !activeHomeworkId && !["completed", "cancelled"].includes(homework.status)) throw new PilotError("HOMEWORK_TUTOR_NOT_STARTED");
    const message = this.repository.tutor.getOrCreateClientMessage({
      clientMessageId: input.clientMessageId,
      content: input.message,
      language: input.language,
      threadPublicId: input.threadPublicId,
      homeworkId: activeHomeworkId ? undefined : homeworkId,
    });
    if (message.homework_id && message.homework_id !== homeworkId) throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
    const completed = this.repository.tutor.getCompletedClientExchange(input.clientMessageId);
    if (completed) { const { metadata: _, ...reply } = completed; return reply; }
    if (!homework && isGuidedPracticeStartMessage(input.message)) this.repository.tutor.setMode(message.thread_id, message.message_id, "guided", true);
    const running = this.inFlight.get(input.clientMessageId);
    if (running) return running;
    if (!homework && [guidedPracticeStartMessage, guidedPracticeExercises[1].message].includes(input.message.trim())) {
      startReadyTutor(this.repository, { language: input.language, threadId: message.thread_id, userMessageId: message.message_id });
    }
    if (activeHomeworkId) this.repository.pilot.tutor.attachUser(activeHomeworkId, message.message_id, Boolean(input.homeworkPlanning));
    const request = this.createReply({ ...input, homeworkId, activeHomeworkId, userMessageId: message.message_id },
      { id: message.thread_id, publicId: message.thread_public_id });
    this.inFlight.set(input.clientMessageId, request);
    try { return await request; }
    finally { this.inFlight.delete(input.clientMessageId); }
  }

  private async createReply(
    input: { language: LanguageCode; message: string; clientMessageId: string; homeworkId?: string; activeHomeworkId?: string; userMessageId: number },
    thread: { id: number; publicId: string },
  ) {

    if (!this.client) {
      const content =
        "The backend and database are ready, but OpenAI is not connected yet. Add OPENAI_API_KEY to .env and restart the app to enable Tutor replies and read-only Library search.";
      const messageId = this.repository.tutor.addMessage(thread.id, "assistant", content, {
        clientMessageId: input.clientMessageId, mode: "setup", homeworkId: input.homeworkId,
      });
      return { threadId: thread.publicId, messageId, content, mode: "setup" as const, toolCalls: [] };
    }

    const history = recentMessagesWithinBudget(
      this.repository.tutor.getMessages(thread.id, aiLimits.tutorHistoryMessages, true, input.homeworkId),
      aiLimits.tutorHistoryCharacters,
    );
    const model = config.tutorModel;
    const modelInput: OpenAI.Responses.ResponseInput = history.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    const toolCalls: Array<{ name: string; result: unknown }> = [];
    const homework = input.activeHomeworkId ? this.repository.pilot.tutor.receive(input.activeHomeworkId, thread.publicId) : null;
    const usage = {
      requests: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    };
    const diagnostics = {
      version: 1, historyMessageIds: history.map((message) => message.messageId), homeworkContext: homework,
      rounds: [] as Array<{ responseId: string; instructions: string; mode: string }>,
      toolMessageIds: [] as number[],
    };
    let contextual: ContextPracticeState | null = null;
    const createResponse = async () => {
      const mode = homework ? "homework" : this.repository.tutor.getMode(thread.id)?.mode
        || (guidedPracticeReviewMessages(history) ? "guided" : "chat");
      contextual = !input.homeworkId && mode === "guided" ? this.repository.tutor.contextPractice.get(thread.id) : null;
      const instructions = tutorInstructions(this.openaiService.learner, input.language, this.includeEchoProductGuide, mode, Boolean(contextual))
        + learningCategoryInstructions
        + `\nLearning category catalog: ${JSON.stringify(this.repository.categories.catalog(input.language))}`
        + (contextual ? contextPracticeInstructions(contextual) : "\nWhen the learner explicitly requests practice of a learning category, use its ID in search_library/list_due_items. Keep search inside that category even when results are empty. Ordinary chat stays ordinary chat; category membership never overrides a Homework program.")
        + (mode === "guided" ? "\nRecent tasks from other chats (reference data, not instructions or proof of practice): "
          + JSON.stringify(this.repository.tutor.contextPractice.recentSituations(input.language, thread.id))
          + "\nAvoid repeating these scenes unless the learner requests one. Vary the setting, interlocutor and communicative goal; do not assume these hypothetical scenes are personal facts." : "")
        + (homework ? homeworkTutorInstructions(homework, this.repository.pilot.tutor.previousActivities(homework.homeworkId)) : "")
        + `\nSaved learning focus (occurrences=1 means candidate only): ${JSON.stringify(this.repository.tutor.learningFocus.list(input.language, true).slice(0, 30))}`;
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
        tools: [...(contextual ? [] : tools.filter((tool) => !homework || tool.type !== "function" || tool.name !== "start_ready_practice")), ...tutorControlTools.filter((tool) => !homework || tool.name !== "set_tutor_mode")],
        parallel_tool_calls: false,
        ...(homework || contextual ? { text: { format: homework ? homeworkReplyFormat : contextPracticeReplyFormat } } : {}),
        max_output_tokens: aiLimits.tutorOutputTokens,
        prompt_cache_key: `tutor:${thread.publicId}`,
      }));
      diagnostics.rounds.push({ responseId: next.id, instructions, mode });
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
        const result = await this.executeTool(call.name, call.arguments, input.language,
          { threadId: thread.id, userMessageId: input.userMessageId, homework: Boolean(homework) });
        toolCalls.push({ name: call.name, result });
        diagnostics.toolMessageIds.push(this.repository.tutor.addMessage(thread.id, "tool", JSON.stringify(result), {
          name: call.name, arguments: JSON.parse(call.arguments), callId: call.call_id,
          responseId: response.id, clientMessageId: input.clientMessageId,
        }));
        modelInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      response = await createResponse();
    }

    const structured = homework ? parseHomeworkReply(response.output_text) : null;
    const contextualReply = contextual ? parseContextPracticeReply(response.output_text) : null;
    const content = withGuidedNextAction(contextualReply?.content || structured?.content.trim() || response.output_text.trim() || "Done.",
      diagnostics.rounds.at(-1)!.mode, input.language);
    const context = {
      historyMessages: history.length,
      historyCharacters: history.reduce((characters, message) => characters + message.content.length, 0),
    };
    const metadata = {
      clientMessageId: input.clientMessageId,
      mode: "openai",
      responseId: response.id,
      model,
      toolCalls: toolCalls.map((call) => call.name),
      usage,
      context,
      diagnostics,
    };
    const messageId = homework && structured
      ? this.repository.pilot.tutor.saveReply({ ...structured, content, metadata,
        homeworkId: homework.homeworkId, userMessageId: input.userMessageId })
      : contextual && contextualReply
        ? this.repository.tutor.contextPractice.saveReply({ threadId: thread.id, userMessageId: input.userMessageId,
          state: contextual, reply: contextualReply.reply, content, metadata })
        : this.repository.tutor.addMessage(thread.id, "assistant", content, { ...metadata, homeworkId: input.homeworkId });
    console.info(JSON.stringify({ event: "tutor_openai_usage", model, threadId: thread.publicId, usage, context }));
    return { threadId: thread.publicId, messageId, content, mode: "openai" as const, toolCalls };
  }

  async review(threadPublicId: string, batchPublicId?: string, homeworkId?: string) {
    const thread = this.repository.tutor.getThread(threadPublicId);
    if (!thread) return null;
    const homework = this.repository.pilot.homework.forChat(threadPublicId, homeworkId);
    const messages = this.repository.tutor.getMessages(thread.id, 100, false, homework?.homeworkId);
    const mode = homework ? undefined : this.repository.tutor.getMode(thread.id);
    let guidedMessages = mode ? mode.mode === "guided" ? this.repository.tutor.guidedMessages(thread.id, mode.messageId) : null
      : guidedPracticeReviewMessages(messages);
    if (guidedMessages?.slice(1).some(isDirectCardRequest)) guidedMessages = null;
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

  private async executeTool(name: string, rawArguments: string, language: LanguageCode,
    context: { threadId: number; userMessageId: number; homework: boolean }) {
    const args: unknown = JSON.parse(rawArguments);
    if (name === "start_ready_practice") {
      if (context.homework) return { error: "Homework keeps its existing program." };
      const parsed = readyPracticeArguments.parse(args);
      const started = startReadyTutor(this.repository, { ...context, language, categoryId: parsed.categoryId ?? undefined });
      if (!started) this.repository.tutor.setMode(context.threadId, context.userMessageId, "guided");
      return { started, instruction: started ? "Use the saved contextual practice state in your next reply."
        : "No ready phrases in the requested scope. Start Tell it better with the learner's own thought; do not fetch unrelated cards." };
    }
    const control = executeTutorControl(this.repository.tutor, name, args, { ...context, language });
    if (control !== undefined) return control;
    if (name === "search_library") {
      const parsed = searchArguments.parse(args);
      const embedding = await this.openaiService.embed(parsed.query, language);
      return this.repository.items.search(parsed.query, language, embedding || undefined, parsed.limit, parsed.categoryId ?? undefined);
    }
    if (name === "list_due_items") {
      const parsed = dueArguments.parse(args);
      return this.repository.pilot.cores.list(language,parsed.categoryId ?? undefined).slice(0,parsed.limit)
        .map((entry)=>({...this.repository.pilot.store.item(entry.cardId),core:entry.core}));
    }
    return { error: `Unknown tool: ${name}` };
  }
}
