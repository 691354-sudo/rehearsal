import { randomUUID } from "node:crypto";
import type { InjectOptions, Response } from "light-my-request";
import type { ReviewRating } from "../../contracts/api.js";

export async function submitPilotRecall(send: (input: InjectOptions) => Promise<Response>, cardId: string,
  rating: ReviewRating = "good", answer = "") {
  const admitted = await send({ method: "POST", url: "/api/pilot/to-recall", payload: {
    language: "en", eventId: randomUUID(), cardId,
  } });
  if (admitted.statusCode !== 200) throw new Error(admitted.body);
  const attemptId = randomUUID(); const shownAt = new Date().toISOString();
  const started = await send({ method: "POST", url: "/api/pilot/attempts/start", payload: {
    language: "en", attemptId, cardId, shownAt, timezone: "Europe/Riga",
  } });
  if (started.statusCode !== 200) throw new Error(started.body);
  return send({ method: "POST", url: "/api/pilot/attempts/grade", payload: {
    language: "en", attemptId, rating, revealedAt: new Date().toISOString(), ratedAt: new Date().toISOString(),
    responseTimeMs: 0, inputMode: answer ? "typed" : "oral_self_check", answer,
  } });
}

// These tests cover Tutor history/transport, independently of Recall admission.
export function readyTutorCard(context: import("./api-test-context.js").ApiTestContext, cardId?: string) {
  const id = cardId ?? context.repository.items.create({ language: "en", cue: "Я справлюсь", target: "I can pull through." },
    context.repository.library.createIsland({ language: "en", title: `Tutor fixture ${randomUUID()}` }).publicId).publicId;
  context.db.prepare("UPDATE pilot_card_progress SET stage='tutor',entered_at=? WHERE card_id=?")
    .run(new Date().toISOString(), id);
}
