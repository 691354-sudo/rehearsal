import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config, openAIConfigured } from "../config.js";
import type { RehearsalRepository } from "../db/repository.js";
import { getModelRouting } from "../model-routing.js";
import type { LanguageCode, LearningItem, ReviewBatchKind, ReviewCandidate } from "../types.js";
import { resolveCaptureReview as resolveCaptureReviewService } from "./capture-review.js";
import {
  generatedCandidateSchema,
  generatedMaterialSchema,
  materialInstructions,
  targetLanguageName,
  toCandidate,
} from "./material-generation.js";

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
    id: z.string(),
    frequencyBand: z.enum(["core", "common", "specific", "rare"]),
    currency: z.enum(["current", "contextual", "dated"]),
  })),
});

export type AttemptEvaluation = z.infer<typeof evaluationSchema>;

const normalize = (value: string) =>
  value
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

  constructor(private readonly repository: OpenAIRepositories) {}

  get configured() {
    return Boolean(this.client);
  }

  async transcribe(input: { audio: Buffer; audioMime: string; filename: string }) {
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const file = new File([new Uint8Array(input.audio)], input.filename, { type: input.audioMime });
    const transcription = await this.client.audio.transcriptions.create({
      file,
      model: config.transcriptionModel,
      languages: ["ru"],
      prompt: "Личная голосовая заметка на русском языке о том, что говорящий хотел бы уметь сказать.",
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
      model: getModelRouting().utility,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      instructions:
        `Verify whether these ${targetLanguageName(language)} expressions are current and naturally used by adults in 2026. ` +
        "Use web search only for this linguistic currency check. Classify frequency conservatively. " +
        "Current means normal adult usage, not merely attested, historical, or forced youth slang. Return every supplied id.",
      input: JSON.stringify(uncertain.map(({ id, target, focusTerms }) => ({ id, target, focusTerms }))),
      text: { format: zodTextFormat(currencyCheckSchema, "currency_check") },
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
    const voice = input.voice || config.ttsVoice;
    const speed = Math.max(0.5, Math.min(1.5, input.speed || 1));
    const cacheKey = createHash("sha256")
      .update([config.ttsModel, voice, speed, input.language, input.text].join("\0"))
      .digest("hex");
    const cached = this.repository.audio.get(cacheKey);
    if (cached) return { ...cached, cached: true };
    const languageName = input.language === "lv" ? "Latvian" : input.language === "ru" ? "Russian" : "English";
    const response = await this.client.audio.speech.create({
      model: config.ttsModel,
      voice,
      input: input.text,
      instructions: `Speak clear, natural ${languageName} for language shadowing. Keep a conversational rhythm and neutral emotion. Speed: ${speed}x.`,
      response_format: "mp3",
    });
    const audio = Buffer.from(await response.arrayBuffer());
    this.repository.audio.save({
      cacheKey,
      model: config.ttsModel,
      voice,
      format: "mp3",
      audio,
    });
    return { format: "mp3", audio, cached: false };
  }

  private async prepareBatch(input: {
    language: LanguageCode;
    kind: ReviewBatchKind;
    title: string;
    sourceText: string;
    task: string;
    sourceThreadPublicId?: string;
  }) {
    if (!this.client) {
      const batch = this.repository.reviews.create({
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
      model: getModelRouting().balanced,
      reasoning: { effort: "low" },
      instructions: materialInstructions(input.language, input.task),
      input: JSON.stringify({
        targetLanguage: targetLanguageName(input.language),
        title: input.title,
        material: input.sourceText.slice(0, 50_000),
      }),
      text: { format: zodTextFormat(generatedMaterialSchema, "learning_candidates") },
    });
    if (!response.output_parsed) throw new Error("The tutor did not return prepared material");
    const candidates = await this.verifyUncertainCandidates(
      response.output_parsed.items.slice(0, 100).map(toCandidate),
      input.language,
    );
    const batch = this.repository.reviews.create({
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

  prepareVocabBatch(input: { language: LanguageCode; title: string; text: string; sourceThreadPublicId?: string }) {
    return this.prepareBatch({
      language: input.language,
      kind: "vocab",
      title: input.title,
      sourceText: input.text,
      sourceThreadPublicId: input.sourceThreadPublicId,
      task:
        "Triage up to 100 pasted vocabulary entries. Deduplicate inflections and near-duplicates. " +
        "For each useful active term, create exactly one natural personalized anchor sentence. " +
        "Keep less useful but still current terms as recognition. Mark outdated, bookish, or irrelevant entries as skip. " +
        "Return no more than one candidate per distinct input term or phrase.",
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
      task:
        "Turn these Russian personal voice-note transcripts into at most 100 high-value speaking cards. " +
        "Merge repeated intentions, ignore filler and recording artifacts, and split distinct useful thoughts. " +
        "Translate intended meaning rather than wording. Prefer direct casual or neutral adult speech, never corporate or bookish phrasing. " +
        "Each active item must be a complete sentence Roman would realistically say. Use one real-life topic in category.",
    });
  }

  async reviseReviewBatch(input: { batchPublicId: string; feedback: string }) {
    const batch = this.repository.reviews.get(input.batchPublicId);
    if (!batch || batch.status !== "draft") return null;
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const response = await this.client.responses.parse({
      model: getModelRouting().balanced,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        batch.language,
        "Revise the complete proposal batch using the user's Russian feedback. " +
          "Numbers in the feedback refer to the current one-based candidate order. " +
          "Keep good candidates, rewrite the requested ones, remove rejected ones, and do not add unrelated material. " +
          "Return the complete revised batch, not only changed items.",
      ),
      input: JSON.stringify({
        title: batch.title,
        source: batch.sourceText,
        currentCandidates: batch.candidates.map((candidate, index) => ({ number: index + 1, ...candidate })),
        feedback: input.feedback.trim(),
      }),
      text: { format: zodTextFormat(generatedMaterialSchema, "revised_learning_candidates") },
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
      verifyCandidates: (candidates, language) => this.verifyUncertainCandidates(candidates, language),
    });
  }

  reviewConversation(input: {
    language: LanguageCode;
    threadPublicId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) {
    return this.prepareBatch({
      language: input.language,
      kind: "chat_review",
      title: "Tutor conversation review",
      sourceThreadPublicId: input.threadPublicId,
      sourceText: input.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      task:
        "Review the complete conversation after it has ended. Extract only the student's meaningful recurring mistakes, " +
        "high-value phrases he was trying to say, and a few reusable patterns. Do not nitpick every sentence. " +
        "Correct collocations and sentence structure first. Return at most 20 proposals.",
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

  async regenerateCandidate(input: {
    batchPublicId: string;
    candidateId: string;
    instruction: "another" | "different_context";
  }) {
    const batch = this.repository.reviews.get(input.batchPublicId);
    const original = batch?.candidates.find((candidate) => candidate.id === input.candidateId);
    if (!batch || !original) return null;
    if (!this.client) throw new Error("OPENAI_NOT_CONFIGURED");
    const response = await this.client.responses.parse({
      model: getModelRouting().balanced,
      reasoning: { effort: "low" },
      instructions: materialInstructions(
        batch.language,
        input.instruction === "different_context"
          ? "Replace the candidate with one natural example using the same focus term in a clearly different relevant context. Return exactly one item."
          : "Replace the candidate with a better natural personal version that keeps the intended focus and meaning. Return exactly one item.",
      ),
      input: JSON.stringify({ batchTitle: batch.title, original }),
      text: { format: zodTextFormat(generatedMaterialSchema, "replacement_candidate") },
    });
    const generated = response.output_parsed?.items[0];
    if (!generated) throw new Error("The tutor did not return a replacement");
    const replacement = { ...toCandidate(generated), id: original.id };
    return this.repository.reviews.replaceCandidate(batch.publicId, original.id, replacement);
  }
}
