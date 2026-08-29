export const guidedPracticeStartMessage =
  "Start a guided practice session for me. Choose the most useful exercise based on my Library and what is due.";

export const guidedPracticeMenuMessage =
  "Give me three guided practice exercises to choose from: Tell it better, Recall & reuse, and Role-play twice.";

type ConversationMessage = { role: "user" | "assistant"; content: string };

const guidedPracticeMessages = new Set([guidedPracticeStartMessage, guidedPracticeMenuMessage]);
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
