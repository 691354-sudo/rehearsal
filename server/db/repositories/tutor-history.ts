import type { ContextPracticeSnapshot } from "../../../contracts/tutor-context-practice.js";
import { makeThreadTitle } from "./shared.js";

// Read existing practice evidence; history presentation never makes a model call.
export function tutorHistoryPresentation(title: string, firstMessage: string, messages: Array<{ content: string; metadata: string }>) {
  const phrases: string[] = [];
  const topics: string[] = [];
  for (const message of messages) {
    const snapshot = (JSON.parse(message.metadata) as { contextPractice?: Partial<ContextPracticeSnapshot> }).contextPractice;
    if (snapshot?.pool && snapshot.selectedTargetIds) {
      for (const id of snapshot.selectedTargetIds) {
        const target = snapshot.pool.find((entry) => entry.id === id);
        if (target?.core) phrases.push(target.core);
        if (target?.topic) topics.push(target.topic);
      }
    }
  }
  const generic = /^(?:let[’']?s (?:have|begin|start|practi[cs]e)|can we (?:have|practi[cs]e)|practi[cs]e my ready|давай|начн[её]м)/i.test(firstMessage)
    || title === "Tutor chat";
  const automatic = title === "Tutor chat" || title === makeThreadTitle(firstMessage);
  const uniquePhrases = [...new Set(phrases)].slice(0, 3);
  const topicTitle = [...new Set(topics)].slice(0, 2).join(" · ");
  return { displayTitle: automatic && generic ? topicTitle || uniquePhrases.slice(0, 2).join(" · ") || "Practice" : title,
    practicePhrases: uniquePhrases };
}
