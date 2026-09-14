export const tutorFeedbackMaxLength = 4_000;

export type TutorFeedback = {
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type TutorHistoryMessage = {
  messageId: number;
  role: "user" | "assistant";
  content: string;
  clientMessageId?: string;
  feedback?: TutorFeedback | null;
};
