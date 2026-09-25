import type { LanguageCode } from "../../contracts/api.js";
import { isRecallPracticeStartMessage, recallPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";
import type { RehearsalRepository } from "../db/repository.js";
import { PilotError } from "../db/pilot/store.js";
import { aiLimits } from "./ai-limits.js";
import type { ContextPracticeTarget } from "../../contracts/tutor-context-practice.js";

type ReadyTutorRepositories = Pick<RehearsalRepository, "tutor" | "pilot" | "items" | "library" | "categories">;

const readyTutorPool = (repository: ReadyTutorRepositories, language: LanguageCode, categoryId?: string) => {
  const pool: ContextPracticeTarget[] = [];
  const categories = repository.categories.catalog(language);
  const topics = new Map(repository.library.listIslands(language).map((topic) => [topic.publicId, topic.title]));
  for (const core of repository.pilot.cores.list(language, categoryId, true).slice(0, 20)) {
    const card = repository.items.get(core.cardId);
    if (!card) continue;
    const target: ContextPracticeTarget = { id: card.publicId, key: core.core ? `core:${core.core}` : `card:${card.publicId}`,
      core: core.core, target: card.target, cue: card.cue,
      topic: card.topicId ? topics.get(card.topicId) ?? "" : "",
      categories: categories.filter((entry) => card.learningCategoryIds?.includes(entry.publicId)).map((entry) => entry.title) };
    if (JSON.stringify([...pool, target]).length + recallPracticeStartMessage.length > aiLimits.tutorMessageCharacters) break;
    pool.push(target);
  }
  return pool;
};

export function startReadyTutor(repository: ReadyTutorRepositories,
  input: { language: LanguageCode; threadId: number; userMessageId: number; categoryId?: string }) {
  if (repository.tutor.contextPractice.get(input.threadId)?.startMessageId === input.userMessageId) return true;
  const pool = readyTutorPool(repository, input.language, input.categoryId);
  if (!pool.length) return false;
  repository.tutor.contextPractice.attach(input.threadId, input.userMessageId, pool);
  return true;
}

export function prepareRecallTutor(repository: ReadyTutorRepositories,
  input: { language: LanguageCode; clientMessageId: string }) {
  const existing = repository.tutor.getClientMessage(input.clientMessageId);
  if (existing) {
    if (existing.language_code !== input.language || !isRecallPracticeStartMessage(existing.content)) {
      throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
    }
    return { threadId: existing.thread_public_id };
  }
  const pool = readyTutorPool(repository, input.language);
  if (!pool.length) throw new PilotError("NO_TUTOR_CARDS");
  return repository.tutor.contextPractice.start(input, pool);
}
