export const guidedPracticeStartMessage =
  "Start a guided practice session for me. Choose the most useful exercise based on my Library and what is due.";

export const guidedPracticeMenuMessage =
  "Give me three guided practice exercises to choose from: Tell it better, Recall & reuse, and Role-play twice.";

export const guidedPracticeExercises = [
  {
    id: "tell-it-better",
    title: "Tell it better",
    description: "Say one thought, repair it, then say it again.",
    message: "Start Tell it better guided practice with me.",
  },
  {
    id: "recall-and-reuse",
    title: "Recall & reuse",
    description: "Recall Library phrases, then reuse them in an answer.",
    message: "Start Recall & reuse guided practice with my due or relevant Library phrases.",
  },
  {
    id: "role-play-twice",
    title: "Role-play twice",
    description: "Repeat one real-life scene after focused feedback.",
    message: "Start Role-play twice guided practice with me.",
  },
  {
    id: "read-and-retell",
    title: "Read → retell",
    description: "Retell your text, then improve the retelling.",
    message: "Start Read → retell guided practice with me. Ask me for a text if I have not supplied one.",
  },
] as const;

type ConversationMessage = { role: "user" | "assistant"; content: string };

const guidedPracticeMessages = new Set([
  guidedPracticeStartMessage,
  guidedPracticeMenuMessage,
  ...guidedPracticeExercises.map((exercise) => exercise.message),
]);
const directCardRequest = /(?:карточк|\bcards?\b)/iu;
const reportedCardRequest = /(?:я хотел(?:а)?\s+(?:ответить|сказать|спросить)|\bi wanted to\s+(?:answer|say|ask)\b)/iu;
const cardRequestDenied = /(?:карточки?\s+(?:делать\s+)?не\s+(?:нужно|надо|делай)|без\s+карточк|\b(?:no|without)\s+cards?\b|\bdon't\s+(?:make|create)\s+cards?\b)/iu;

const isDirectCardRequest = (message: ConversationMessage) => message.role === "user"
  && directCardRequest.test(message.content)
  && !reportedCardRequest.test(message.content)
  && !cardRequestDenied.test(message.content);

export const guidedPracticeReviewMessages = (messages: ConversationMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "user" || !guidedPracticeMessages.has(messages[index].content.trim())) continue;
    const guidedMessages = messages.slice(index);
    return guidedMessages.slice(1).some(isDirectCardRequest) ? null : guidedMessages;
  }
  return null;
};

export const comparableGuidedPracticeTarget = (value: string) => value
  .normalize("NFC")
  .toLocaleLowerCase()
  .replace(/[’‘]/gu, "'")
  .replace(/[^\p{L}\p{N}']+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();
