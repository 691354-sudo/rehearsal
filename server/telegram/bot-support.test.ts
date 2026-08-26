import { describe, expect, it } from "vitest";
import { TelegramBotSupport } from "./bot-support.js";
import type { TelegramBotClient, TelegramMessage } from "./types.js";

const client = {} as TelegramBotClient;
const support = new TelegramBotSupport(client, "https://example.test/rehearsal/");
const message = (content: Partial<TelegramMessage>): TelegramMessage => ({
  message_id: 1,
  chat: { id: 1, type: "private" },
  ...content,
});

describe("Telegram bot media support", () => {
  it("accepts every supported Telegram audio/video shape", () => {
    expect(support.audioMedia(message({ voice: { file_id: "voice" } }))?.mime).toBe("audio/ogg");
    expect(support.audioMedia(message({ audio: { file_id: "audio", mime_type: "audio/mpeg" } }))?.mime).toBe("audio/mpeg");
    expect(support.audioMedia(message({ video_note: { file_id: "video-note" } }))?.mime).toBe("video/mp4");
    expect(support.audioMedia(message({ video: { file_id: "video", mime_type: "video/webm" } }))?.mime).toBe("video/webm");
  });

  it("infers supported audio documents from filenames and rejects unrelated files", () => {
    expect(support.audioMedia(message({ document: { file_id: "m4a", file_name: "note.m4a" } }))?.mime).toBe("audio/mp4");
    expect(support.audioMedia(message({ document: { file_id: "pdf", file_name: "note.pdf", mime_type: "application/pdf" } }))).toBeNull();
  });
});
