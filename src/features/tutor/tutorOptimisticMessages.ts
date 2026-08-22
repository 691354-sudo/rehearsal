import type { ChatMessage } from "../../shared/contracts";

export const tutorPlaceholderId = (clientMessageId: string) => `${clientMessageId}:assistant`;

export const beginTutorSend = (messages: ChatMessage[], content: string, clientMessageId: string) => {
  const placeholderId = tutorPlaceholderId(clientMessageId);
  const withoutPlaceholder = messages.filter((message) => message.id !== placeholderId);
  const existingIndex = withoutPlaceholder.findIndex((message) => message.clientMessageId === clientMessageId);
  const userMessage: ChatMessage = {
    id: clientMessageId, role: "user", content, clientMessageId, status: "sending",
  };
  const next = existingIndex >= 0
    ? withoutPlaceholder.map((message, index) => index === existingIndex ? userMessage : message)
    : [...withoutPlaceholder, userMessage];
  return [...next, { id: placeholderId, role: "assistant", content: "", status: "placeholder" } satisfies ChatMessage];
};

export const completeTutorSend = (messages: ChatMessage[], clientMessageId: string, content: string) =>
  messages.map((message) => {
    if (message.clientMessageId === clientMessageId) return { ...message, status: "sent" as const };
    if (message.id === tutorPlaceholderId(clientMessageId)) return { ...message, content, status: "sent" as const };
    return message;
  });

export const failTutorSend = (messages: ChatMessage[], clientMessageId: string) => messages
  .filter((message) => message.id !== tutorPlaceholderId(clientMessageId))
  .map((message) => message.clientMessageId === clientMessageId
    ? { ...message, status: "failed" as const }
    : message);
