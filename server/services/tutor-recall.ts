import type { LanguageCode } from "../../contracts/api.js";
import { isRecallPracticeStartMessage, recallPracticeStartMessage } from "../../contracts/tutor-guided-practice.js";
import type { RehearsalRepository } from "../db/repository.js";
import { PilotError } from "../db/pilot/store.js";
import { aiLimits } from "./ai-limits.js";

export function prepareRecallTutor(repository: Pick<RehearsalRepository, "tutor" | "pilot" | "items">,
  input: { language: LanguageCode; clientMessageId: string }) {
  const existing = repository.tutor.getClientMessage(input.clientMessageId);
  if (existing) {
    if (existing.language_code !== input.language || !isRecallPracticeStartMessage(existing.content)) {
      throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
    }
    return { threadId: existing.thread_public_id };
  }
  let content = recallPracticeStartMessage;
  let count = 0;
  for (const core of repository.pilot.cores.list(input.language).slice(0, 20)) {
    const card = repository.items.get(core.cardId);
    if (!card) continue;
    const phrase = `\n\n${count + 1}. ${card.target}\n${card.cue}`;
    if ((content + phrase).length > aiLimits.tutorMessageCharacters) break;
    content += phrase; count++;
  }
  if (!count) throw new PilotError("NO_TUTOR_CARDS");
  // Persist the selected phrases before navigation so retries keep the same chat and list.
  const message = repository.tutor.getOrCreateClientMessage({ ...input, content });
  repository.tutor.setMode(message.thread_id, message.message_id, "guided", true);
  return { threadId: message.thread_public_id };
}
