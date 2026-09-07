import type { ListenAppearance, ListenLike } from "../../../contracts/learning-pilot";

export type PendingPilotEvent = { path: "/listens"; body: ListenAppearance } | { path: "/likes"; body: ListenLike };
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Entry = { order: number; event: PendingPilotEvent };
export class PilotOutbox {
  private active = true;
  private flushing = false;
  private unsaved = new Map<string, Entry>();
  private lastOrder = 0;
  constructor(private readonly storage: StoragePort, private readonly prefix: string,
    private readonly send: (event: PendingPilotEvent) => Promise<unknown>,
    private readonly changed: () => void,
    private readonly failed: (error: unknown) => void,
    private readonly saved: (event: PendingPilotEvent, response: unknown) => void) {}

  pending(): PendingPilotEvent[] {
    const entries = new Map<string, Entry>();
    try {
      for (let index = 0; index < this.storage.length; index++) {
        const key = this.storage.key(index);
        if (!key?.startsWith(`${this.prefix}:`)) continue;
        const value = this.storage.getItem(key);
        if (value) {
          const entry = JSON.parse(value) as Entry;
          if (!entry.event?.body?.eventId || !["/listens", "/likes"].includes(entry.event.path)) throw new Error("Saved progress could not be read.");
          entries.set(entry.event.body.eventId, entry);
        }
      }
    } catch (error) { this.failed(error); }
    for (const [id, entry] of this.unsaved) entries.set(id, entry);
    return [...entries.values()].sort((a, b) => a.order - b.order || a.event.body.eventId.localeCompare(b.event.body.eventId)).map((entry) => entry.event);
  }

  enqueue(event: PendingPilotEvent) {
    const entry = { order: this.lastOrder = Math.max(Date.now(), this.lastOrder + 0.001), event };
    this.unsaved.set(event.body.eventId, entry);
    try { this.storage.setItem(`${this.prefix}:${event.body.eventId}`, JSON.stringify(entry)); }
    catch (error) { this.failed(error); }
    this.changed();
    void this.flush();
  }

  async flush() {
    if (this.flushing || !this.active) return;
    this.flushing = true;
    try {
      while (this.active) {
        const event = this.pending()[0];
        if (!event) break;
        const response = await this.send(event);
        // One key per event: acknowledging in this tab cannot erase another tab's append.
        this.storage.removeItem(`${this.prefix}:${event.body.eventId}`);
        this.unsaved.delete(event.body.eventId);
        if (!this.active) break;
        this.saved(event, response); this.changed();
      }
    } catch (error) { if (this.active) this.failed(error); }
    finally { this.flushing = false; }
  }
  stop() { this.active = false; }
}
