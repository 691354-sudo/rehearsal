import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";

describe("private Tutor learning focus", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); });
  afterEach(() => context.close());
  const observation = { key: "past-simple", title: "Past simple for finished events", detail: "Use went for a finished trip.", quote: "Yesterday I go home." };
  const message = (context: ApiTestContext, language: "en" | "lv" = "en", content = observation.quote) => {
    const thread = context.repository.tutor.getOrCreateThread(undefined, language);
    const id = context.repository.tutor.addMessage(thread.id, "user", content, {}, randomUUID());
    return { thread, id };
  };

  it("requires distinct learner messages, deduplicates retries, and persists across chats and restart", () => {
    const first = message(context);
    const focus = context.repository.tutor.learningFocus;
    expect(focus.record("en", first.id, observation)).toMatchObject({ status: "observed_once", occurrences: 1 });
    expect(focus.record("en", first.id, observation)).toMatchObject({ occurrences: 1 });
    expect(focus.list("en")).toEqual([]);
    const second = message(context);
    expect(focus.record("en", second.id, observation)).toMatchObject({ status: "saved", occurrences: 2 });
    context.reopen();
    expect(context.repository.tutor.learningFocus.list("en")).toEqual([expect.objectContaining({ key: "past-simple", occurrences: 2 })]);
    expect(context.repository.tutor.learningFocus.list("lv", true)).toEqual([]);
    const other = createApiTestContext();
    try { expect(other.repository.tutor.learningFocus.list("en", true)).toEqual([]); }
    finally { other.close(); }
  });

  it("rejects fabricated, assistant-only and cross-language evidence", () => {
    const first = message(context);
    const assistant = context.repository.tutor.addMessage(first.thread.id, "assistant", observation.quote);
    const focus = context.repository.tutor.learningFocus;
    expect(focus.record("en", first.id, { ...observation, quote: "invented" })).toHaveProperty("error");
    expect(focus.record("en", assistant, observation)).toHaveProperty("error");
    expect(focus.record("lv", first.id, observation)).toHaveProperty("error");
    expect(focus.list("en", true)).toEqual([]);
  });

  it("removes a topic and prevents old evidence from recreating it", () => {
    const first = message(context); const second = message(context);
    const focus = context.repository.tutor.learningFocus;
    focus.record("en", first.id, observation); focus.record("en", second.id, observation);
    expect(focus.remove("lv", observation.key)).toEqual({ removed: false });
    expect(focus.list("en")).toHaveLength(1);
    expect(focus.remove("en", observation.key)).toEqual({ removed: true });
    expect(focus.list("en", true)).toEqual([]);
    expect(focus.record("en", second.id, observation)).toEqual({ status: "dismissed" });
    expect(focus.record("en", message(context).id, observation)).toMatchObject({ status: "observed_once" });
    expect(focus.list("en")).toEqual([]);
  });

  it("removes source evidence when its chat is deleted, without changing cards or schedules", () => {
    const before = context.repository.system.stats();
    const first = message(context); const second = message(context);
    const focus = context.repository.tutor.learningFocus;
    focus.record("en", first.id, observation); focus.record("en", second.id, observation);
    context.repository.tutor.deleteThread(first.thread.publicId);
    expect(focus.list("en")).toEqual([]);
    expect(focus.list("en", true)[0].occurrences).toBe(1);
    expect(context.repository.system.stats()).toEqual(before);
    expect(context.db.pragma("foreign_key_check")).toEqual([]);
  });
});
