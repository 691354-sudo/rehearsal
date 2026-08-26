import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileManager } from "../profiles/manager.js";
import { OpenAIService } from "../services/openai.js";
import { TutorService } from "../services/tutor.js";
import { reviewCandidate } from "../testing/candidates.js";
import {
  TelegramEchoBot,
  type BotServices,
  type TelegramBotClient,
  type TelegramReplyMarkup,
  type TelegramUpdate,
} from "./bot.js";

class FakeTelegramClient implements TelegramBotClient {
  readonly messages: Array<{ chatId: string; text: string; markup?: TelegramReplyMarkup; messageId: number }> = [];
  readonly edits: Array<{ chatId: string; text: string; markup?: TelegramReplyMarkup; messageId: number }> = [];
  readonly actions: string[] = [];
  readonly callbacks: Array<{ id: string; text?: string }> = [];
  readonly files = new Map<string, { bytes: Buffer; mime?: string; filename?: string }>();

  async sendMessage(chatId: string, text: string, markup?: TelegramReplyMarkup) {
    const messageId = this.messages.length + 1;
    this.messages.push({ chatId, text, markup, messageId });
    return { message_id: messageId };
  }

  async editMessageText(chatId: string, messageId: number, text: string, markup?: TelegramReplyMarkup) {
    this.edits.push({ chatId, messageId, text, markup });
  }

  async sendChatAction(chatId: string) { this.actions.push(chatId); }
  async answerCallbackQuery(id: string, text?: string) { this.callbacks.push({ id, text }); }
  async download(fileId: string) {
    const file = this.files.get(fileId);
    if (!file) throw new Error("FILE_NOT_FOUND");
    return file;
  }
}

const pins = { roman: "1234", oliver: "5678", zanna: "2345" };
const messageUpdate = (
  updateId: number,
  userId: number,
  message: Omit<NonNullable<TelegramUpdate["message"]>, "message_id" | "from" | "chat">,
): TelegramUpdate => ({
  update_id: updateId,
  message: {
    message_id: updateId,
    from: { id: userId },
    chat: { id: userId, type: "private" },
    ...message,
  },
});

describe("Echo Telegram bot", () => {
  let tempDir: string;
  let manager: ProfileManager;
  let client: FakeTelegramClient;
  let services: Map<string, BotServices>;
  let bot: TelegramEchoBot;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rehearsal-telegram-bot-"));
    manager = await ProfileManager.create({
      dataDir: path.join(tempDir, "data"),
      backupDir: path.join(tempDir, "backups"),
      legacyDatabasePath: path.join(tempDir, "data", "rehearsal.sqlite"),
      pins,
    });
    manager.telegram.bind({ profileId: "roman", userId: "101", chatId: "101", language: "en" });
    manager.telegram.bind({ profileId: "roman", userId: "202", chatId: "202", language: "en" });
    client = new FakeTelegramClient();
    services = new Map();
    const serviceFor = (profileId: string) => {
      const existing = services.get(profileId);
      if (existing) return existing;
      const profile = manager.get(profileId);
      const openai = new OpenAIService(profile.repository);
      const next = { openai, tutor: new TutorService(profile.repository, openai) };
      services.set(profileId, next);
      return next;
    };
    bot = new TelegramEchoBot(
      manager,
      client,
      "https://example.test/rehearsal/",
      ["roman"],
      ["101", "202"],
      { 101: ["roman"], 202: ["roman"] },
      serviceFor,
    );
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rejects Telegram users outside the runtime allowlist", async () => {
    manager.telegram.bind({ profileId: "roman", userId: "303", chatId: "303", language: "en" });
    await bot.processUpdate(messageUpdate(1, 303, { text: "Should not be saved" }));

    expect(client.messages).toHaveLength(1);
    expect(client.messages[0]?.text).toBe("This bot is private.");
    expect(manager.get("roman").repository.capture.list("en")).toEqual([]);
  });

  it("uses Notebook by default and keeps repeated text, voice, and .txt updates idempotent", async () => {
    const openai = services.get("roman")?.openai || (() => {
      const profile = manager.get("roman");
      const created = new OpenAIService(profile.repository);
      services.set("roman", { openai: created, tutor: new TutorService(profile.repository, created) });
      return created;
    })();
    vi.spyOn(openai, "transcribe").mockResolvedValue("Расшифрованная часть.");
    client.files.set("voice-1", { bytes: Buffer.from("voice"), mime: "audio/ogg", filename: "voice.ogg" });
    client.files.set("text-1", { bytes: Buffer.from("Текст из файла."), mime: "text/plain", filename: "note.txt" });

    const text = messageUpdate(1, 101, { text: "Первая заметка." });
    await bot.processUpdate(text);
    await bot.processUpdate(text);
    await bot.processUpdate(messageUpdate(2, 101, {
      caption: "Подпись.",
      voice: { file_id: "voice-1", file_size: 5, mime_type: "audio/ogg" },
    }));
    await bot.processUpdate(messageUpdate(3, 101, {
      document: { file_id: "text-1", file_size: 16, file_name: "note.txt", mime_type: "text/plain" },
    }));
    await bot.processUpdate(messageUpdate(4, 101, {
      caption: "Подпись к неподдерживаемому фото.",
      photo: [{ file_id: "photo-caption" }],
    }));
    expect(client.messages.at(-1)?.text).toContain("caption was saved");
    await bot.processUpdate(messageUpdate(5, 101, { photo: [{ file_id: "photo-unsupported" }] }));

    const notes = manager.get("roman").repository.capture.list("en");
    expect(notes).toHaveLength(4);
    expect(notes.map((note) => note.transcript)).toEqual(expect.arrayContaining([
      "Первая заметка.",
      "Подпись.\n\nРасшифрованная часть.",
      "Текст из файла.",
      "Подпись к неподдерживаемому фото.",
    ]));
    expect(client.messages.at(-1)?.text).toContain("not supported");
    expect(openai.transcribe).toHaveBeenCalledTimes(1);
  });

  it("starts a new internal Tutor thread every time and keeps Tutor media out of Notebook", async () => {
    const profile = manager.get("roman");
    const openai = new OpenAIService(profile.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    vi.spyOn(openai, "transcribe").mockResolvedValue("Can we practise this?");
    services.set("roman", { openai, tutor: new TutorService(profile.repository, openai) });
    client.files.set("voice-tutor", { bytes: Buffer.from("voice"), mime: "audio/ogg", filename: "voice.ogg" });

    await bot.processUpdate(messageUpdate(10, 101, { text: "Tutor" }));
    await bot.processUpdate(messageUpdate(11, 101, { text: "First Tutor message" }));
    const firstThread = manager.telegram.get("101")!.binding.tutorThreadId;
    await bot.processUpdate(messageUpdate(12, 101, { text: "New Tutor" }));
    expect(manager.telegram.get("101")!.binding.tutorThreadId).toBeNull();
    await bot.processUpdate(messageUpdate(13, 101, {
      voice: { file_id: "voice-tutor", file_size: 5, mime_type: "audio/ogg" },
    }));
    const secondThread = manager.telegram.get("101")!.binding.tutorThreadId;

    expect(firstThread).toBeTruthy();
    expect(secondThread).toBeTruthy();
    expect(secondThread).not.toBe(firstThread);
    expect(profile.repository.tutor.listThreads("en")).toHaveLength(2);
    expect(profile.repository.capture.list("en")).toEqual([]);
    expect(client.actions.length).toBeGreaterThan(0);
  });

  it("prepares one draft batch on retry and never adds it to Library", async () => {
    const profile = manager.get("roman");
    profile.repository.capture.createText({ language: "en", transcript: "Мне нужно перенести встречу." });
    const beforeItems = profile.repository.items.list("en", 500).length;
    const openai = new OpenAIService(profile.repository);
    vi.spyOn(openai, "prepareCaptureBatch").mockImplementation(async (input) => ({
      mode: "openai" as const,
      batch: profile.repository.reviews.create({
        publicId: input.publicId,
        language: input.language,
        kind: "capture",
        title: "Capture Reality",
        candidates: [reviewCandidate({ target: "I need to reschedule the meeting.", cue: "Мне нужно перенести встречу." })],
      }),
    }));
    services.set("roman", { openai, tutor: new TutorService(profile.repository, openai) });

    const prepare = messageUpdate(20, 101, { text: "Prepare cards" });
    await bot.processUpdate(prepare);
    await bot.processUpdate(prepare);

    expect((profile.db.prepare("SELECT COUNT(*) AS count FROM review_batches").get() as { count: number }).count).toBe(1);
    expect(profile.repository.items.list("en", 500)).toHaveLength(beforeItems);
    expect(client.edits[0].text).toContain("1 card draft ready");
    expect(JSON.stringify(client.edits[0].markup)).toContain("/tutor/notebook?lang=en");
  });

  it("reports empty and provider-failed Notebook preparation without consuming notes", async () => {
    await bot.processUpdate(messageUpdate(21, 101, { text: "Prepare cards" }));
    expect(client.messages.at(-1)?.text).toBe("Preparing cards…");
    expect(client.edits.at(-1)?.text).toContain("no ready Notebook notes");

    const profile = manager.get("roman");
    const note = profile.repository.capture.createText({ language: "en", transcript: "Мне нужно уточнить время." });
    const openai = new OpenAIService(profile.repository);
    vi.spyOn(openai, "prepareCaptureBatch").mockRejectedValue(new Error("PROVIDER_FAILED"));
    services.set("roman", { openai, tutor: new TutorService(profile.repository, openai) });
    await bot.processUpdate(messageUpdate(22, 101, { text: "Prepare cards" }));

    expect(client.edits.at(-1)?.text).toContain("notes are unchanged");
    expect(profile.repository.capture.get(note.publicId)?.status).toBe("ready");
    expect((profile.db.prepare("SELECT COUNT(*) AS count FROM review_batches").get() as { count: number }).count).toBe(0);
  });

  it("opens an exact Tutor review deep link and does not duplicate the batch", async () => {
    const profile = manager.get("roman");
    const openai = new OpenAIService(profile.repository);
    vi.spyOn(openai, "configured", "get").mockReturnValue(false);
    vi.spyOn(openai, "reviewConversation").mockImplementation((input) => ({
      mode: "stored" as const,
      batch: profile.repository.reviews.create({
        publicId: input.publicId,
        language: input.language,
        kind: "chat_review",
        title: "Tutor conversation review",
        sourceThreadPublicId: input.threadPublicId,
        candidates: [reviewCandidate()],
      }),
    }));
    services.set("roman", { openai, tutor: new TutorService(profile.repository, openai) });
    await bot.processUpdate(messageUpdate(30, 101, { text: "Tutor" }));
    await bot.processUpdate(messageUpdate(31, 101, { text: "I am agree with this." }));

    const finish = messageUpdate(32, 101, { text: "Finish & review" });
    await bot.processUpdate(finish);
    await bot.processUpdate(finish);

    const markup = JSON.stringify(client.edits.at(-1)?.markup);
    const threadId = manager.telegram.get("101")!.binding.tutorThreadId!;
    expect(markup).toContain(`thread=${threadId}`);
    expect(markup).toContain("review=");
    expect((profile.db.prepare("SELECT COUNT(*) AS count FROM review_batches").get() as { count: number }).count).toBe(1);
  });

  it("keeps account modes independent and rejects declared files above 20 MB", async () => {
    await bot.processUpdate(messageUpdate(40, 101, { text: "Tutor" }));
    await bot.processUpdate(messageUpdate(41, 202, { text: "Заметка второго аккаунта." }));
    expect(manager.telegram.get("101")!.binding.mode).toBe("tutor");
    expect(manager.telegram.get("202")!.binding.mode).toBe("notebook");
    await bot.processUpdate(messageUpdate(42, 202, {
      voice: { file_id: "too-large", file_size: 20 * 1024 * 1024 + 1, mime_type: "audio/ogg" },
    }));
    expect(client.messages.at(-1)?.text).toContain("20 MB or smaller");
    expect(manager.get("roman").repository.capture.list("en")).toHaveLength(1);
  });
});
