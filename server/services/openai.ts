import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config, openAIConfigured } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { LanguageCode, LearningItem, ReviewBatchKind, ReviewCandidate } from "../types.js";
import { aiLimits, assertAiSourceWithinBudget, conversationSourceWithinBudget } from "./ai-limits.js";
import {
  resolveCaptureReview as resolveCaptureReviewService,
  resolveReviewBatch,
} from "./capture-review.js";
import {
  capturePreparationTask,
  generatedMaterialSchema,
  materialInstructions,
  numberCardsFromConversation,
  targetLanguageName,
  toCandidate,
  tutorConversationReviewTask,
  vocabularyPreparationTask,
} from "./material-generation.js";
import { genericLearnerPersona, type LearnerPersona } from "./learner-persona.js";
import { rewriteLibraryItem as rewriteLibraryItemService } from "./library-item-rewrite.js";
import { prepareDelimitedImport } from "./delimited-import.js";
import { reviseReviewCandidate } from "./review-candidate.js";
import { normalizeNfc } from "../../contracts/text.js";

const evaluationSchema = z.object({
  score: z.number().min(0).max(1),
  verdict: z.enum(["exact", "close", "retry"]),
  meaningPreserved: z.boolean(),
  naturalAnswer: z.string(),
  correctedAnswer: z.string(),
  summaryRu: z.string(),
  mistakes: z.array(
    z.object({
      original: z.string(),
      correction: z.string(),
      explanationRu: z.string(),
      type: z.enum(["grammar", "collocation", "word_choice", "missing_word", "spelling", "style"]),
    }),
  ),
});

const currencyCheckSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    frequencyBand: z.enum(["core", "common", "specific", "rare"]),
    currency: z.enum(["current", "contextual", "dated"]),
  })).max(8),
});

export type AttemptEvaluation = z.infer<typeof evaluationSchema>;

const normalize = (value: string) =>
  normalizeNfc(value)
    .toLocaleLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshtein = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const localEvaluation = (item: LearningItem, answer: string): AttemptEvaluation => {
  const candidates = [item.target, ...item.acceptedAnswers];
  const normalizedAnswer = normalize(answer);
  const best = candidates
    .map((candidate) => {
      const normalizedCandidate = normalize(candidate);
      const distance = levenshtein(normalizedAnswer, normalizedCandidate);
      const score = 1 - distance / Math.max(normalizedAnswer.length, normalizedCandidate.length, 1);
      return { candidate, score };
    })
    .sort((left, right) => right.score - left.score)[0];
  const score = Math.max(0, Math.min(1, best.score));
  const verdict = score >= 0.98 ? "exact" : score >= 0.72 ? "close" : "retry";
  return {
    score,
    verdict,
    meaningPreserved: score >= 0.62,
    naturalAnswer: item.target,
    correctedAnswer: item.target,
    summaryRu:
      verdict === "exact"
        ? "Точно. Фраза воспроизведена естественно."
        : verdict === "close"
          ? "Смысл понятен. Сравни свой вариант с естественной формулировкой."
          : "Попробуй ещё раз и опирайся на готовую конструкцию целиком.",
    mistakes: [],
  };
};

type OpenAIRepositories = Pick<RehearsalRepository, "audio" | "reviews">;

export class OpenAIService {
  private readonly client = openAIConfigured
    ? new OpenAI({ apiKey: config.openaiApiKey })
    : null;
  private readonly inflightSpeech = new Map<string, Promise<{ format: string; audio: Buffer }>>();

  constructor(
    private readonly repository: OpenAIRepositories,
    readonly learner: LearnerPersona = genericLearnerPersona,
  ) {}

  get configured() {
    return Boolean(this.client);
  }

  async transcribe(input: {
    audio: Buffer;
    audioMime: string;
    filename: string;
    languages?: string[];
    prompt?: string;
  }) {
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const file = new File([new Uint8Array(input.audio)], input.filename, { type: input.audioMime });
    const transcription = await this.client.audio.transcriptions.create({
      file,
      model: config.transcriptionModel,
      languages: input.languages || ["ru"],
      prompt: input.prompt || "Личная голосовая заметка на русском языке о том, что говорящий хотел бы уметь сказать.",
    });
    const text = transcription.text.trim();
    if (!text) throw new Error("EMPTY_TRANSCRIPTION");
    return text;
  }

  async embed(text: string) {
    if (!this.client) return null;
    const response = await this.client.embeddings.create({
      model: config.embeddingModel,
      input: text.replace(/\s+/g, " ").trim(),
      encoding_format: "float",
      dimensions: config.embeddingDimensions,
    });
    return response.data[0]?.embedding || null;
  }

  evaluate(item: LearningItem, answer: string) {
    return { evaluation: localEvaluation(item, answer), mode: "local" as const };
  }

  private async verifyUncertainCandidates(candidates: ReviewCandidate[], language: LanguageCode) {
    if (!this.client) return candidates;
    const uncertain = candidates.filter((candidate) => candidate.currency === "uncertain").slice(0, 8);
    if (!uncertain.length) return candidates;
    const response = await this.client.responses.parse({
      model: config.utilityModel,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      instructions:
        `Verify whether these ${targetLanguageName(language)} expressions are current and naturally used by adults in ${new Date().getFullYear()}. ` +
        "Use web search only for this linguistic currency check. Classify frequency conservatively. " +
        "Current means normal adult usage, not merely attested, historical, or forced youth slang. Return every supplied id.",
      input: JSON.stringify(uncertain.map(({ id, target, focusTerms }) => ({ id, target, focusTerms }))),
      text: { format: zodTextFormat(currencyCheckSchema, "currency_check") },
      max_output_tokens: aiLimits.utilityOutputTokens,
    });
    const checks = new Map((response.output_parsed?.items || []).map((item) => [item.id, item]));
    return candidates.map((candidate) => {
      const check = checks.get(candidate.id);
      return check ? { ...candidate, currency: check.currency, frequencyBand: check.frequencyBand } : candidate;
    });
  }

  async speech(input: {
    text: string;
    language: LanguageCode | "ru";
    voice?: string;
    speed?: number;
  }) {
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const cacheKey = this.speechCacheKey(input);
    const cached = this.repository.audio.get(cacheKey);
    if (cached) return { ...cached, cached: true };
    const pending = this.inflightSpeech.get(cacheKey);
    if (pending) return { ...await pending, cached: true };
    const voice = input.voice || config.ttsVoice;
    const speed = Math.max(0.5, Math.min(1.5, input.speed || 1));
    const generation = this.client.audio.speech.create({
      model: config.ttsModel,
      voice,
      input: input.text.trim().normalize("NFC"),
      speed,
      response_format: "mp3",
    }).then(async (response) => {
      const audio = Buffer.from(await response.arrayBuffer());
      this.repository.audio.save({
        cacheKey,
        model: config.ttsModel,
        voice,
        format: "mp3",
        audio,
      });
      return { format: "mp3", audio };
    }).finally(() => this.inflightSpeech.delete(cacheKey));
    this.inflightSpeech.set(cacheKey, generation);
    return { ...await generation, cached: false };
  }

  cachedSpeech(input: { text: string; language: LanguageCode | "ru"; voice?: string; speed?: number }) {
    return this.repository.audio.get(this.speechCacheKey(input));
  }

  private speechCacheKey(input: { text: string; language: LanguageCode | "ru"; voice?: string; speed?: number }) {
    const voice = input.voice || config.ttsVoice;
    const speed = Math.max(0.5, Math.min(1.5, input.speed || 1));
    return createHash("sha256")
      .update(["openai", config.ttsModel, voice, speed, input.language, input.text.trim().normalize("NFC")].join("\0"))
      .digest("hex");
  }

  private async prepareBatch(input: { publicId?: string; language: LanguageCode; kind: ReviewBatchKind;
    title: string; sourceText: string; task: string; sourceThreadPublicId?: string }) {
    if (!this.client) {
      const batch = this.repository.reviews.create({
        publicId: input.publicId,
        language: input.language,
        kind: input.kind,
        title: input.title,
        sourceText: input.sourceText,
        candidates: [],
        sourceThreadPublicId: input.sourceThreadPublicId,
      });
      return { batch, mode: "stored" as const };
    }
    const response = await this.client.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(this.learner, input.language, input.task),
      input: JSON.stringify({
        targetLanguage: targetLanguageName(input.language),
        title: input.title,
        material: assertAiSourceWithinBudget(input.sourceText),
      }),
      text: { format: zodTextFormat(generatedMaterialSchema, "learning_candidates") },
      max_output_tokens: aiLimits.batchOutputTokens,
    });
    if (!response.output_parsed) throw new Error("The tutor did not return prepared material");
    const candidates = await this.verifyUncertainCandidates(
      response.output_parsed.items.slice(0, 100).map(toCandidate),
      input.language,
    );
    const batch = this.repository.reviews.create({
      publicId: input.publicId,
      language: input.language,
      kind: input.kind,
      title: input.title,
      sourceText: input.sourceText,
      candidates,
      sourceThreadPublicId: input.sourceThreadPublicId,
    });
    return { batch, mode: "openai" as const };
  }

  prepareImportedMaterial(input: { language: LanguageCode; title: string; text: string }) {
    return this.prepareBatch({
      language: input.language,
      kind: "text_import",
      title: input.title,
      sourceText: input.text,
      task:
        "Turn the selected text into at most 20 high-value cards for shadowing and recall. " +
        "Preserve good original wording, skip repetitions and contextless lines, and keep connected lines when a short paragraph is more useful than one sentence.",
    });
  }

  prepareDelimitedImportedMaterial(input: { language: LanguageCode; title: string; text: string }) {
    return prepareDelimitedImport({ client: this.client, repository: this.repository, learner: this.learner, ...input });
  }

  prepareVocabBatch(input: { publicId?: string; language: LanguageCode; title: string; text: string;
    sourceThreadPublicId?: string }) {
    return this.prepareBatch({
      publicId: input.publicId,
      language: input.language,
      kind: "vocab",
      title: input.title,
      sourceText: input.text,
      sourceThreadPublicId: input.sourceThreadPublicId,
      task: vocabularyPreparationTask,
    });
  }

  prepareCaptureBatch(input: {
    language: LanguageCode;
    notes: Array<{ publicId: string; transcript: string }>;
  }) {
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const sourceText = input.notes
      .map((note, index) => `[${index + 1} · ${note.publicId}]\n${note.transcript}`)
      .join("\n\n");
    return this.prepareBatch({
      language: input.language,
      kind: "capture",
      title: "Capture Reality",
      sourceText,
      task: capturePreparationTask(this.learner.name),
    });
  }

  async reviseReviewBatch(input: { batchPublicId: string; feedback: string }) {
    const batch = this.repository.reviews.get(input.batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const response = await this.client.responses.parse({
      model: config.balancedModel,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        this.learner,
        batch.language,
        "Revise the complete proposal batch using the user's Russian feedback. " +
          "Numbers in the feedback refer to the current one-based candidate order. " +
          "Keep good candidates, rewrite the requested ones, remove rejected ones, and do not add unrelated material. " +
          "Return the complete revised batch, not only changed items.",
      ),
      input: JSON.stringify({
        title: batch.title,
        source: assertAiSourceWithinBudget(batch.sourceText),
        currentCandidates: batch.candidates.map((candidate, index) => ({ number: index + 1, ...candidate })),
        feedback: input.feedback.trim(),
      }),
      text: { format: zodTextFormat(generatedMaterialSchema, "revised_learning_candidates") },
      max_output_tokens: aiLimits.batchOutputTokens,
    });
    if (!response.output_parsed) throw new Error("The tutor did not return revised material");
    const candidates = await this.verifyUncertainCandidates(
      response.output_parsed.items.slice(0, 100).map(toCandidate),
      batch.language,
    );
    return this.repository.reviews.replaceCandidates(batch.publicId, candidates, input.feedback);
  }

  async resolveCaptureReview(input: {
    batchPublicId: string;
    accepted: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>;
    revisions: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category"> & { feedback: string }>;
  }) {
    return resolveCaptureReviewService({
      client: this.client,
      input,
      repository: this.repository,
      learner: this.learner,
      verifyCandidates: (candidates, language) => this.verifyUncertainCandidates(candidates, language),
    });
  }

  async resolveReview(input: {
    batchPublicId: string;
    accepted: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category">>;
    revisions: Array<Pick<ReviewCandidate, "id" | "target" | "cue" | "note" | "category"> & { feedback: string }>;
  }) {
    return resolveReviewBatch({
      client: this.client,
      input,
      repository: this.repository,
      learner: this.learner,
      verifyCandidates: (candidates, language) => this.verifyUncertainCandidates(candidates, language),
    });
  }

  reviewConversation(input: {
    language: LanguageCode;
    threadPublicId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) {
    const sourceText = conversationSourceWithinBudget(input.messages);
    const numberCards = numberCardsFromConversation(input.messages);
    if (numberCards.length) {
      const batch = this.repository.reviews.create({
        language: input.language,
        kind: "vocab",
        title: "Numbers from Tutor",
        sourceThreadPublicId: input.threadPublicId,
        sourceText,
        candidates: numberCards,
      });
      return { batch, mode: "stored" as const };
    }
    return this.prepareBatch({
      language: input.language,
      kind: "chat_review",
      title: "Tutor conversation review",
      sourceThreadPublicId: input.threadPublicId,
      sourceText,
      task: tutorConversationReviewTask,
    });
  }

  generatePatternDrill(input: { language: LanguageCode; item: LearningItem }) {
    return this.prepareBatch({
      language: input.language,
      kind: "pattern_drill",
      title: `Pattern: ${input.item.target}`,
      sourceText: JSON.stringify({ target: input.item.target, cue: input.item.cue, note: input.item.note }),
      task:
        "Create 6 practical substitution-drill variants from this base card. Change one meaningful slot at a time, " +
        "keep the same reusable grammar/collocation frame, and avoid trivial synonym lists.",
    });
  }

  rewriteLibraryItem(input: {
    language: LanguageCode;
    target: string;
    cue: string;
    note: string;
    feedback: string;
  }) {
    return rewriteLibraryItemService({ client: this.client, learner: this.learner, ...input });
  }

  regenerateCandidate(input: {
    batchPublicId: string;
    candidateId: string;
    instruction: "another" | "different_context";
  }) {
    return reviseReviewCandidate({ client: this.client, repository: this.repository, learner: this.learner, ...input });
  }

  reviseCandidate(input: { batchPublicId: string; candidateId: string; feedback: string;
    draft: Pick<ReviewCandidate, "target" | "cue" | "note" | "category"> }) {
    return reviseReviewCandidate({
      client: this.client, repository: this.repository, learner: this.learner,
      instruction: "feedback", ...input,
    });
  }
}
