import { useEffect, useRef } from "react";
import { isRecallPracticeStartMessage } from "../../../contracts/tutor-guided-practice";
import type { ChatMessage } from "../../shared/contracts";

export function useRecallTutorStart(messages: ChatMessage[], ready: boolean, busy: boolean,
  send: (content: string, clientMessageId: string) => Promise<boolean>) {
  const attempted = useRef("");
  useEffect(() => {
    const first = messages[0];
    if (!ready || busy || messages.length !== 1 || first.role !== "user" || !first.clientMessageId
      || first.status === "failed" || !isRecallPracticeStartMessage(first.content)
      || attempted.current === first.clientMessageId) return;
    attempted.current = first.clientMessageId;
    void send(first.content, first.clientMessageId);
  }, [messages, ready, busy, send]);
}
