import { describe, expect, it } from "vitest";
import { PilotOutbox, type PendingPilotEvent } from "./outbox";

const storage = () => {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
};
const event = (id: string, liked = true): PendingPilotEvent => ({ path: "/likes", body: { eventId: id, cardId: "card", language: "en", liked, occurredAt: "2026-09-07T10:00:00.000Z" } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
describe("durable pilot outbox", () => {
  it("keeps identical event payloads across retries and reloads, with profile isolation", async () => {
    const store = storage(); const sent: PendingPilotEvent[] = [];
    const offline = new PilotOutbox(store, "roman", async () => { throw new Error("offline"); }, () => undefined, () => undefined, () => undefined);
    offline.enqueue(event("one")); await tick(); offline.stop();
    new PilotOutbox(store, "oliver", async () => undefined, () => undefined, () => undefined, () => undefined).enqueue(event("foreign")); await tick();
    const resumed = new PilotOutbox(store, "roman", async (entry) => { sent.push(entry); }, () => undefined, () => undefined, () => undefined);
    await resumed.flush(); expect(sent).toEqual([event("one")]); expect(resumed.pending()).toEqual([]);
  });
  it("does not erase another tab's append while a request is pending", async () => {
    const store = storage(); let release: () => void = () => undefined;
    const sent: PendingPilotEvent[] = [];
    const queue = new PilotOutbox(store, "roman", async (entry) => { sent.push(entry); if (sent.length === 1) await new Promise<void>((resolve) => { release = resolve; }); }, () => undefined, () => undefined, () => undefined);
    queue.enqueue(event("one"));
    store.setItem("roman:two", JSON.stringify({ order: Date.now() + 1, event: event("two", false) }));
    release(); await tick();
    expect(sent).toEqual([event("one"), event("two", false)]); expect(queue.pending()).toEqual([]);
  });
  it("never throws into audio completion if storage cannot be accessed", async () => {
    const store = storage(); store.setItem = () => { throw new Error("full"); }; store.getItem = () => { throw new Error("blocked"); };
    const sent: PendingPilotEvent[] = []; const failures: unknown[] = [];
    const queue = new PilotOutbox(store, "roman", async (entry) => { sent.push(entry); }, () => queue.pending(), (error) => failures.push(error), () => undefined);
    expect(() => queue.enqueue(event("one"))).not.toThrow(); await tick();
    expect(sent).toEqual([event("one")]); expect(failures.length).toBeGreaterThan(0);
  });
});
