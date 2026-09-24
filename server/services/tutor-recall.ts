import type { LanguageCode } from "../../contracts/api.js";
import { isRecallPracticeStartMessage, recallPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";
import type { RehearsalRepository } from "../db/repository.js";
import { PilotError } from "../db/pilot/store.js";
import { aiLimits } from "./ai-limits.js";
import type { ContextPracticeTarget } from "../../contracts/tutor-context-practice.js";

export function prepareRecallTutor(repository: Pick<RehearsalRepository, "tutor" | "pilot" | "items" | "library" | "categories">,
  input: { language: LanguageCode; clientMessageId: string }) {
  const existing = repository.tutor.getClientMessage(input.clientMessageId);
  if (existing) {
    if (existing.language_code !== input.language || !isRecallPracticeStartMessage(existing.content)) {
      throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
    }
    return { threadId: existing.thread_public_id };
  }
  const pool: ContextPracticeTarget[] = [];
  const categories = repository.categories.catalog(input.language);
  const topics = new Map(repository.library.listIslands(input.language).map((topic) => [topic.publicId, topic.title]));
  for (const core of repository.pilot.cores.list(input.language, undefined, true).slice(0, 20)) {
    const card = repository.items.get(core.cardId);
    if (!card) continue;
    const target: ContextPracticeTarget = { id: card.publicId, key: core.core ? `core:${core.core}` : `card:${card.publicId}`,
      core: core.core, target: card.target, cue: card.cue,
      topic: card.topicId ? topics.get(card.topicId) ?? "" : "",
      categories: categories.filter((entry) => card.learningCategoryIds?.includes(entry.publicId)).map((entry) => entry.title) };
    if (JSON.stringify([...pool, target]).length + recallPracticeStartMessage.length > aiLimits.tutorMessageCharacters) break;
    pool.push(target);
  }
  if (!pool.length) throw new PilotError("NO_TUTOR_CARDS");
  return repository.tutor.contextPractice.start(input, pool);
}
