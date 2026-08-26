export const aiLimits = {
  sourceCharacters: 50_000,
  tutorHistoryMessages: 200,
  tutorHistoryCharacters: 40_000,
  tutorMessageCharacters: 8_000,
  tutorOutputTokens: 2_000,
  batchOutputTokens: 16_000,
  utilityOutputTokens: 2_000,
} as const;

type ConversationMessage = { role: "user" | "assistant"; content: string };

export const recentMessagesWithinBudget = <Message extends ConversationMessage>(
  messages: Message[],
  maxCharacters: number,
) => {
  const selected: Message[] = [];
  let characters = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const nextCharacters = message.role.length + message.content.length + 2;
    if (characters + nextCharacters > maxCharacters) break;
    selected.unshift(message);
    characters += nextCharacters;
  }
  return selected;
};

export const conversationSourceWithinBudget = (messages: ConversationMessage[]) => {
  const selected = recentMessagesWithinBudget(messages, aiLimits.sourceCharacters);
  const omitted = messages.length - selected.length;
  const source = selected.map((message) => `${message.role}: ${message.content}`).join("\n\n");
  return omitted ? `[${omitted} earlier messages omitted by the review input limit]\n\n${source}` : source;
};

export const assertAiSourceWithinBudget = (source: string) => {
  if (source.length > aiLimits.sourceCharacters) throw new Error("AI_SOURCE_TOO_LARGE");
  return source;
};
