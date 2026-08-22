import { describe, expect, it } from "vitest";
import { beginTutorSend, completeTutorSend, failTutorSend } from "./tutorOptimisticMessages";

describe("optimistic Tutor messages", () => {
  const clientMessageId = "8d438346-ab30-4f21-9384-207b7b34cc0c";

  it("shows the user message and assistant placeholder immediately", () => {
    expect(beginTutorSend([], "Hello", clientMessageId)).toEqual([
      expect.objectContaining({ role: "user", content: "Hello", clientMessageId, status: "sending" }),
      expect.objectContaining({ role: "assistant", status: "placeholder" }),
    ]);
  });

  it("replaces the placeholder without duplicating the user message", () => {
    const pending = beginTutorSend([], "Hello", clientMessageId);
    const completed = completeTutorSend(pending, clientMessageId, "Hi there");
    expect(completed).toHaveLength(2);
    expect(completed).toEqual([
      expect.objectContaining({ role: "user", status: "sent" }),
      expect.objectContaining({ role: "assistant", content: "Hi there", status: "sent" }),
    ]);
  });

  it("keeps a failed bubble and reuses it on retry", () => {
    const failed = failTutorSend(beginTutorSend([], "Hello", clientMessageId), clientMessageId);
    expect(failed).toEqual([expect.objectContaining({ role: "user", status: "failed" })]);
    const retried = beginTutorSend(failed, "Hello", clientMessageId);
    expect(retried.filter((message) => message.role === "user")).toHaveLength(1);
    expect(retried).toContainEqual(expect.objectContaining({ role: "assistant", status: "placeholder" }));
  });
});
