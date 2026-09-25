import type { LanguageCode } from "../../../contracts/api.js";
import type { ContextPracticeReply, ContextPracticeSnapshot, ContextPracticeState, ContextPracticeTarget } from "../../../contracts/tutor-context-practice.js";
import { isRecallPracticeStartMessage, recallPracticeStartMessage } from "../../../contracts/tutor-guided-practice.js";
import type { RehearsalDatabase } from "../database.js";
import { PilotError } from "../pilot/store.js";
import type { TutorRepository } from "./tutor.js";

export class TutorContextPracticeRepository {
  constructor(private readonly db: RehearsalDatabase, private readonly tutor: TutorRepository) {}

  start(input: { language: LanguageCode; clientMessageId: string }, pool: ContextPracticeTarget[]) {
    return this.db.transaction(() => {
      const existing = this.tutor.getClientMessage(input.clientMessageId);
      if (existing) {
        if (existing.language_code !== input.language || !isRecallPracticeStartMessage(existing.content)) {
          throw new Error("CLIENT_MESSAGE_ID_CONFLICT");
        }
        return { threadId: existing.thread_public_id };
      }
      const message = this.tutor.getOrCreateClientMessage({ ...input, content: recallPracticeStartMessage });
      this.attach(message.thread_id, message.message_id, pool);
      return { threadId: message.thread_public_id };
    }).immediate();
  }

  attach(threadId: number, userMessageId: number, pool: ContextPracticeTarget[]) {
    return this.db.transaction(() => {
      const snapshot: ContextPracticeSnapshot = { version: 1, pool, selectedTargetIds: [] };
      this.db.prepare(`UPDATE chat_messages SET metadata = json_set(metadata, '$.contextPractice', json(?))
        WHERE id = ? AND thread_id = ? AND role = 'user' AND json_type(metadata, '$.contextPractice') IS NULL`)
        .run(JSON.stringify(snapshot), userMessageId, threadId);
      this.tutor.setMode(threadId, userMessageId, "guided", true);
    }).immediate();
  }

  recentSituations(language: LanguageCode, currentThreadId: number) {
    const rows = this.db.prepare(`SELECT m.thread_id AS threadId, m.content,
      json_extract(m.metadata, '$.contextPractice.task.contextId') AS contextId,
      json_extract(m.metadata, '$.contextPractice.startMessageId') AS startMessageId,
      json_extract(m.metadata, '$.contextPractice.nextAction') AS nextAction
      FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
      WHERE t.language_code = ? AND t.id != ? AND m.role = 'assistant'
      AND json_extract(m.metadata, '$.homeworkId') IS NULL
      AND (json_type(m.metadata, '$.contextPractice.task') = 'object' OR m.content LIKE '%### Next Task%')
      ORDER BY m.id DESC LIMIT 40`).all(language, currentThreadId) as Array<{
        threadId: number; content: string; contextId: string | null; startMessageId: number | null; nextAction: string | null;
      }>;
    const seen = new Set<string>();
    const situations: string[] = [];
    for (const row of rows) {
      const text = (row.nextAction || row.content.split(/(?:^|\n)\s*#{1,3}\s+Next task\s*\n/i)[1] || "").trim().slice(0, 500);
      const key = row.contextId ? `${row.threadId}:${row.startMessageId}:${row.contextId}` : text;
      if (!text || seen.has(key)) continue;
      seen.add(key);
      situations.push(text);
      if (situations.length === 6) break;
    }
    return situations;
  }

  get(threadId: number): ContextPracticeState | null {
    const mode = this.tutor.getMode(threadId);
    if (mode?.mode !== "guided") return null;
    const row = this.db.prepare("SELECT json_extract(metadata, '$.contextPractice') AS snapshot FROM chat_messages WHERE id = ? AND thread_id = ?")
      .get(mode.messageId, threadId) as { snapshot: string | null } | undefined;
    if (!row?.snapshot) return null;
    const snapshot = JSON.parse(row.snapshot) as ContextPracticeSnapshot;
    const previous = this.db.prepare(`SELECT id, json_extract(metadata, '$.contextPractice') AS state FROM chat_messages
      WHERE thread_id = ? AND role = 'assistant' AND json_extract(metadata, '$.contextPractice.startMessageId') = ?
      ORDER BY id DESC LIMIT 1`).get(threadId, mode.messageId) as { id: number; state: string } | undefined;
    const saved = previous ? JSON.parse(previous.state) as Pick<ContextPracticeReply, "task" | "status" | "nextAction"> : null;
    const progress = this.db.prepare(`SELECT target_id AS targetId, COUNT(DISTINCT context_id) AS contexts,
      SUM(outcome = 'independent') AS independent, SUM(outcome = 'assisted') AS assisted,
      SUM(outcome = 'not_used') AS notUsed FROM tutor_context_attempts WHERE start_message_id = ? GROUP BY target_id`)
      .all(mode.messageId) as ContextPracticeState["progress"];
    return { startMessageId: mode.messageId, lastReplyId: previous?.id ?? null, snapshot,
      status: saved?.status ?? "active", pendingTask: saved?.task ?? null,
      pendingInstruction: saved?.nextAction ?? null, progress };
  }

  saveReply(input: { threadId: number; userMessageId: number; state: ContextPracticeState;
    reply: ContextPracticeReply; content: string; metadata: Record<string, unknown> }, now = new Date().toISOString()) {
    return this.db.transaction(() => {
      const { state, reply } = input;
      const current = this.get(input.threadId);
      if (!current || current.startMessageId !== state.startMessageId || current.lastReplyId !== state.lastReplyId) {
        throw new PilotError("TUTOR_CONTEXT_STALE", 409);
      }
      const user = this.db.prepare(`SELECT m.content, t.language_code AS language FROM chat_messages m
        JOIN chat_threads t ON t.id = m.thread_id WHERE m.id = ? AND m.thread_id = ? AND m.role = 'user'`)
        .get(input.userMessageId, input.threadId) as { content: string; language: LanguageCode } | undefined;
      if (!user || input.userMessageId < state.startMessageId || (state.lastReplyId && input.userMessageId <= state.lastReplyId)) {
        throw new PilotError("TUTOR_CONTEXT_STALE", 409);
      }
      const invalid = () => { throw new PilotError("TUTOR_REPLY_INCOMPLETE", 502); };
      const { pool, selectedTargetIds } = state.snapshot;
      const chosen = reply.selectedTargetIds;
      if (new Set(chosen).size !== chosen.length || chosen.length < Math.min(5, pool.length)
        || chosen.length > Math.min(8, pool.length) || chosen[0] !== pool[0].id
        || chosen.some((id) => !pool.some((target) => target.id === id))) invalid();
      if (selectedTargetIds.length && JSON.stringify(chosen) !== JSON.stringify(selectedTargetIds)) invalid();
      if (!reply.nextAction.trim() || (reply.status === "active") !== Boolean(reply.task)) invalid();
      if (reply.task && (new Set(reply.task.targetIds).size !== reply.task.targetIds.length
        || reply.task.targetIds.some((id) => !chosen.includes(id)))) invalid();
      if (!state.lastReplyId && (!reply.task?.targetIds.includes(chosen[0]) || reply.task.support !== "none")) invalid();
      if (new Set(reply.observations.map((entry) => entry.targetId)).size !== reply.observations.length) invalid();
      for (const observation of reply.observations) {
        if (!state.pendingTask?.targetIds.includes(observation.targetId) || !chosen.includes(observation.targetId)
          || !user!.content.includes(observation.quote) || input.userMessageId === state.startMessageId) invalid();
        if (observation.outcome === "independent" && state.pendingTask!.support !== "none") invalid();
      }
      // Assistance cannot disappear while repeating the same situation after a hint.
      const support = ["none", "meaning", "partial", "model"];
      if (reply.task && state.pendingTask?.contextId === reply.task.contextId
        && support.indexOf(reply.task.support) < support.indexOf(state.pendingTask.support)) invalid();
      const snapshot: ContextPracticeSnapshot = { ...state.snapshot, selectedTargetIds: chosen };
      this.db.prepare("UPDATE chat_messages SET metadata = json_set(metadata, '$.contextPractice', json(?)) WHERE id = ?")
        .run(JSON.stringify(snapshot), state.startMessageId);
      const messageId = this.tutor.addMessage(input.threadId, "assistant", input.content, { ...input.metadata,
        contextPractice: { startMessageId: state.startMessageId, task: reply.task, status: reply.status,
          nextAction: reply.nextAction, observations: reply.observations } });
      for (const observation of reply.observations) {
        const target = pool.find((entry) => entry.id === observation.targetId)!;
        this.db.prepare(`INSERT INTO tutor_context_attempts(start_message_id, user_message_id, assistant_message_id,
          language_code, target_id, target_key, context_id, quote, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(state.startMessageId, input.userMessageId, messageId, user!.language, target.id, target.key,
            state.pendingTask!.contextId, observation.quote, observation.outcome, now);
      }
      if (reply.status === "complete") {
        const progress = this.get(input.threadId)!.progress;
        if (chosen.some((id) => (progress.find((entry) => entry.targetId === id)?.contexts ?? 0) < 2)) invalid();
      }
      return messageId;
    }).immediate();
  }
}
