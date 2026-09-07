import { randomUUID } from "node:crypto";
import type { InjectOptions, Response } from "light-my-request";
import type { ReviewRating } from "../../contracts/api.js";

export async function submitPilotRecall(send: (input: InjectOptions) => Promise<Response>, cardId: string,
  rating: ReviewRating = "good", answer = "") {
  for (let index = 0; index < 5; index++) {
    const listened = await send({ method: "POST", url: "/api/pilot/listens", payload: {
      language: "en", eventId: randomUUID(), appearanceId: randomUUID(), listenSessionId: randomUUID(), cardId,
      completedAt: new Date().toISOString(), audioRepeatsInAppearance: 3,
    } });
    if (listened.statusCode !== 200) throw new Error(listened.body);
  }
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
