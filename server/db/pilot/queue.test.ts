import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiTestContext, type ApiTestContext } from "../../testing/api-test-context.js";
const now = "2026-10-01T12:00:00.000Z";

describe("learning recommendations", () => {
  let context: ApiTestContext;
  beforeEach(() => { context = createApiTestContext(); context.db.prepare("DELETE FROM items").run(); });
  afterEach(() => context.close());
  const topic = () => context.repository.library.createIsland({ language: "en", title: randomUUID() });
  const card = (topicId: string) => context.repository.items.create({ language: "en", cue: "Пример", target: randomUUID() }, topicId);
  const listen = (id: string, completedAt: string) => context.repository.pilot.listening.complete({ eventId: randomUUID(), appearanceId: randomUUID(),
    listenSessionId: randomUUID(), cardId: id, language: "en", completedAt, audioRepeatsInAppearance: 1 }, now);

  it("uses 80/20 when both pools are available and ranks new Library cards by category, then Topic", () => {
    const a = topic(), b = topic();
    const category = context.repository.categories.create({ language: "en", title: "Collocations" });
    const secondary = context.repository.categories.create({ language: "en", title: "Daily phrases" });
    const started = Array.from({length: 9}, () => card(a.publicId));
    started.forEach((item, index) => listen(item.publicId, `2026-09-30T10:0${index}:00.000Z`));
    context.repository.categories.setForCard(started[0].publicId, [category.publicId, secondary.publicId]);
    const sameCategory = card(b.publicId), sameTopic = card(a.publicId), unrelated = card(b.publicId);
    context.repository.categories.setForCard(sameCategory.publicId, [category.publicId, secondary.publicId]);
    context.db.prepare("UPDATE items SET created_at='2020-01-01T00:00:00Z' WHERE public_id=?").run(unrelated.publicId);
    const items = context.repository.pilot.queue.listen({limit:10},now);
    expect(items.slice(0,8).map((item) => item.publicId)).toEqual(started.slice(0,8).map((item) => item.publicId));
    expect(items.slice(8).map((item) => item.publicId)).toEqual([sameCategory.publicId, sameTopic.publicId]);
    expect(context.repository.pilot.queue.listen({limit:50,categoryId:category.publicId},now).map((item) => item.publicId))
      .toEqual([started[0].publicId, sameCategory.publicId]);
  });

  it("selects from the whole database before the inventory and session limits", () => {
    const group = topic();
    const oldest = card(group.publicId);
    Array.from({length: 510}, () => card(group.publicId));
    context.db.prepare("UPDATE items SET created_at='2000-01-01T00:00:00Z',updated_at='2000-01-01T00:00:00Z' WHERE public_id=?").run(oldest.publicId);
    expect(context.repository.practice.listInventory("en",500).some((item) => item.publicId === oldest.publicId)).toBe(false);
    const selected = context.repository.pilot.queue.listen({limit:50},now);
    expect(selected).toHaveLength(50);
    expect(selected[0].publicId).toBe(oldest.publicId);
  });

  it("puts due learning before review, orders review by retrieval risk, and excludes future reviews", () => {
    const group = topic();
    const [learning, fragile, stable, future, fresh] = Array.from({length: 5}, () => card(group.publicId));
    for (const item of [learning,fragile,stable,future]) {
      context.repository.practice.recordAttempt({ itemPublicId:item.publicId,mode:"recall",answer:"",score:1,verdict:"good",rating:"good",feedback:{},reviewedAt:new Date("2026-09-01T00:00:00Z") });
      context.db.prepare("UPDATE pilot_card_progress SET stage='recall' WHERE card_id=?").run(item.publicId);
    }
    const state = context.db.prepare("UPDATE review_state SET state=?,stability=?,due_at=? WHERE item_id=?");
    state.run(1,10,"2026-09-30T12:00:00Z",learning.id);
    state.run(2,1,"2026-09-30T12:00:00Z",fragile.id);
    state.run(2,50,"2026-09-01T12:00:00Z",stable.id);
    state.run(2,1,"2027-01-01T12:00:00Z",future.id);
    context.repository.pilot.listening.toRecall({eventId:randomUUID(),language:"en",cardId:fresh.publicId},now);
    expect(context.repository.pilot.queue.list({limit:10},now).map((item) => item.publicId))
      .toEqual([learning.publicId,fragile.publicId,stable.publicId,fresh.publicId]);
  });
});
