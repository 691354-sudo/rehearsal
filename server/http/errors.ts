import { z } from "zod";
import { ElevenLabsError } from "../services/elevenlabs.js";
import { AudioPreparationError } from "../services/audio-preparation.js";

export const toErrorResponse = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return { statusCode: 400, body: { error: "INVALID_REQUEST", details: error.issues } };
  }
  if (error instanceof Error && error.message === "OPENAI_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      body: { error: "OPENAI_NOT_CONFIGURED", message: "Add OPENAI_API_KEY to .env and restart the API." },
    };
  }
  if (error instanceof Error && error.message === "ELEVENLABS_NOT_CONFIGURED") {
    return {
      statusCode: 503,
      body: { error: "ELEVENLABS_NOT_CONFIGURED", message: "Add ELEVENLABS_API_KEY to .env and restart the API." },
    };
  }
  if (error instanceof Error && error.message === "EMPTY_TRANSCRIPTION") {
    return { statusCode: 422, body: { error: "EMPTY_TRANSCRIPTION", message: "No speech was detected." } };
  }
  if (error instanceof Error && error.message === "TOPIC_TITLE_EXISTS") {
    return { statusCode: 409, body: { error: "TOPIC_TITLE_EXISTS" } };
  }
  if (error instanceof Error && ["TOPIC_ITEM_NOT_FOUND", "TOPIC_NOT_FOUND"].includes(error.message)) {
    return { statusCode: 404, body: { error: error.message } };
  }
  if (error instanceof Error && error.message === "TOPIC_ITEM_DUPLICATE") {
    return { statusCode: 400, body: { error: "TOPIC_ITEM_DUPLICATE" } };
  }
  if (error instanceof Error && error.message === "TOPIC_LANGUAGE_MISMATCH") {
    return { statusCode: 409, body: { error: "TOPIC_LANGUAGE_MISMATCH" } };
  }
  if (error instanceof Error && error.message === "THREAD_LANGUAGE_MISMATCH") {
    return { statusCode: 409, body: { error: "THREAD_LANGUAGE_MISMATCH" } };
  }
  if (error instanceof Error && error.message === "CLIENT_MESSAGE_ID_CONFLICT") {
    return { statusCode: 409, body: { error: "CLIENT_MESSAGE_ID_CONFLICT" } };
  }
  if (error instanceof Error && ["IMPORT_NO_FRAGMENTS", "IMPORT_TOO_MANY_FRAGMENTS", "IMPORT_FRAGMENT_TOO_LONG"].includes(error.message)) {
    return { statusCode: 400, body: { error: error.message } };
  }
  if (error instanceof Error && ["INCOMPLETE_DELIMITED_IMPORT", "INVALID_IMPORT_FOCUS"].includes(error.message)) {
    return { statusCode: 502, body: { error: error.message } };
  }
  const statusCode = typeof error === "object" && error && "statusCode" in error
    ? Number((error as { statusCode?: number }).statusCode)
    : 0;
  if (statusCode === 413) {
    return { statusCode: 413, body: { error: "AUDIO_TOO_LARGE", message: "Recordings must be 25 MB or smaller." } };
  }
  if (error instanceof ElevenLabsError) {
    return { statusCode: error.statusCode, body: { error: error.code, message: error.message } };
  }
  if (error instanceof AudioPreparationError) {
    return { statusCode: error.statusCode, body: { error: error.code } };
  }
  if (error && typeof error === "object" && "code" in error && error.code === "FST_CSRF_INVALID_TOKEN") {
    return { statusCode: 403, body: { error: "INVALID_CSRF_TOKEN" } };
  }
  return {
    statusCode: 500,
    body: { error: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Unknown error" },
  };
};
