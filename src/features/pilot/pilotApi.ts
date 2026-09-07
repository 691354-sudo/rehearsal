import { apiFetch } from "../../shared/api";

export class PilotRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export const pilotRequest = async <T>(profileId: string, path: string, body?: unknown): Promise<T> => {
  const response = await apiFetch(`/api/pilot${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Rehearsal-Profile": profileId },
    ...(body === undefined ? {} : { body: JSON.stringify({ language: "en", ...body as object }) }),
  });
  const data = await response.json();
  if (!response.ok) throw new PilotRequestError(data.error || "Could not save. Please retry.", response.status);
  return data as T;
};
export const pilotErrorMessage = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    CARD_NOT_AVAILABLE_FOR_RECALL: "This card is no longer due. Refresh the queue to continue.",
    DAILY_NEW_CARD_LIMIT: "Today's new-card limit is reached. Due reviews are still available.",
    HOMEWORK_ATTEMPT_LIMIT: "This card has reached its limit for this Homework.",
    HOMEWORK_STAGE_FINISHED: "This stage has finished. Reopen Homework to continue.",
    HOMEWORK_RECALL_FINISHED: "Recall has finished. Return to Tutor.",
    HOMEWORK_ALREADY_ACTIVE: "This chat already has Homework. Continue the saved session.",
    HOMEWORK_TIME_FINISHED: "The planned time is up. Finish this session or choose Continue.",
    TUTOR_REPLY_INCOMPLETE: "Tutor could not finish the reply. Your message is saved; retry it.",
    PROFILE_CHANGED: "Your profile changed. Reopen this profile to sync its progress.",
    PILOT_CARD_NOT_FOUND: "This card was removed. Its pending change could not be saved.",
  };
  return messages[code] || "Could not connect. Your work is kept here; please retry.";
};

export const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
