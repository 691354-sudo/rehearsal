import { z } from "zod";

export type ContextPracticeTarget = {
  id: string;
  key: string;
  core: string;
  target: string;
  cue: string;
  topic: string;
  categories: string[];
};

export type ContextPracticeSnapshot = {
  version: 1;
  pool: ContextPracticeTarget[];
  selectedTargetIds: string[];
};

export const contextPracticeReply = z.object({
  content: z.string(),
  nextAction: z.string(),
  selectedTargetIds: z.array(z.string()).min(1).max(8),
  status: z.enum(["active", "complete"]),
  task: z.object({
    targetIds: z.array(z.string()).min(1).max(2),
    contextId: z.string().trim().min(1).max(80),
    support: z.enum(["none", "meaning", "partial", "model"]),
  }).nullable(),
  observations: z.array(z.object({
    targetId: z.string(),
    quote: z.string().trim().min(1).max(1000),
    outcome: z.enum(["independent", "assisted", "not_used"]),
  })).max(2),
});

export type ContextPracticeReply = z.infer<typeof contextPracticeReply>;
export type ContextPracticeState = {
  startMessageId: number;
  lastReplyId: number | null;
  snapshot: ContextPracticeSnapshot;
  status: ContextPracticeReply["status"];
  pendingTask: ContextPracticeReply["task"];
  pendingInstruction: string | null;
  progress: Array<{ targetId: string; contexts: number; independent: number; assisted: number; notUsed: number }>;
};
