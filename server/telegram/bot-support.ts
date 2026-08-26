import { createHash } from "node:crypto";
import path from "node:path";
import type { LanguageCode } from "../../contracts/api.js";
import { audioUploadExtension } from "../http/audio-upload.js";
import type {
  TelegramBotClient,
  TelegramDocument,
  TelegramFile,
  TelegramMessage,
  TelegramReplyMarkup,
} from "./types.js";

const telegramFileLimit = 20 * 1024 * 1024;
const telegramTextLimit = 4_000;
const audioMimeByExtension = new Map([
  [".m4a", "audio/mp4"], [".mp4", "video/mp4"], [".webm", "audio/webm"],
  [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".ogg", "audio/ogg"],
]);

export const deterministicUuid = (kind: string, userId: string, updateId: number) => {
  const bytes = createHash("sha256").update(`${kind}\0${userId}\0${updateId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const commandIs = (text: string, command: string) =>
  new RegExp(`^/${command}(?:@[a-z0-9_]+)?(?:\\s|$)`, "i").test(text);

export const appendCaption = (caption: string | undefined, transcript: string) =>
  [caption?.trim(), transcript.trim()].filter(Boolean).join("\n\n");

export class TelegramBotSupport {
  constructor(private readonly client: TelegramBotClient, private readonly miniAppUrl: string) {}

  async sendLongMessage(chatId: string, text: string, markup: TelegramReplyMarkup) {
    const chunks: string[] = [];
    let remaining = text.trim();
    while (remaining.length > telegramTextLimit) {
      let split = remaining.lastIndexOf("\n", telegramTextLimit);
      if (split < telegramTextLimit / 2) split = telegramTextLimit;
      chunks.push(remaining.slice(0, split));
      remaining = remaining.slice(split).trimStart();
    }
    if (remaining) chunks.push(remaining);
    for (let index = 0; index < chunks.length; index += 1) {
      await this.client.sendMessage(chatId, chunks[index], index === chunks.length - 1 ? markup : undefined);
    }
  }

  async downloadChecked(chatId: string, file: TelegramFile) {
    if (file.file_size && file.file_size > telegramFileLimit) {
      await this.client.sendMessage(chatId, "Telegram files must be 20 MB or smaller.");
      return null;
    }
    try {
      const downloaded = await this.client.download(file.file_id);
      if (downloaded.bytes.byteLength > telegramFileLimit) {
        await this.client.sendMessage(chatId, "Telegram files must be 20 MB or smaller.");
        return null;
      }
      return downloaded;
    } catch {
      await this.client.sendMessage(chatId, "I couldn't download that Telegram file. Try sending it again.");
      return null;
    }
  }

  isTextDocument(document: TelegramDocument) {
    return document.mime_type?.toLocaleLowerCase().split(";")[0] === "text/plain"
      || path.extname(document.file_name || "").toLocaleLowerCase() === ".txt";
  }

  audioMedia(message: TelegramMessage) {
    if (message.voice) return { file: message.voice, mime: message.voice.mime_type || "audio/ogg" };
    if (message.audio) return { file: message.audio, mime: message.audio.mime_type || "audio/mpeg" };
    if (message.video_note) return { file: message.video_note, mime: "video/mp4" };
    if (message.video) return { file: message.video, mime: message.video.mime_type || "video/mp4" };
    if (message.document && !this.isTextDocument(message.document)) {
      const declared = message.document.mime_type || "";
      const inferred = audioMimeByExtension.get(path.extname(message.document.file_name || "").toLocaleLowerCase());
      if (audioUploadExtension(declared) || inferred) return { file: message.document, mime: declared || inferred || "" };
    }
    return null;
  }

  transcriptionLanguages(language: LanguageCode) {
    return {
      en: ["en", "ru"], lv: ["lv", "ru", "en"], vi: ["vi", "ru", "en"],
      no: ["no", "ru", "en"], id: ["id", "ru", "en"],
    }[language];
  }

  async unsupported(chatId: string, language: LanguageCode, mode: "notebook" | "tutor" = "notebook") {
    await this.client.sendMessage(chatId,
      mode === "notebook"
        ? "This attachment is not supported. Send text, a .txt file, voice, audio, video note, or video. Nothing was saved."
        : "Tutor accepts text, .txt files, voice, audio, video notes, and video. Nothing was saved.",
      this.keyboard(mode, language));
  }

  async sendConnect(chatId: string) {
    await this.client.sendMessage(chatId, "Open Echo and enter your profile PIN once to connect this Telegram account.", this.openAppMarkup("Connect Echo"));
  }

  private miniAppHref(route = "", language?: LanguageCode, extra: Record<string, string> = {}) {
    const base = this.miniAppUrl.endsWith("/") ? this.miniAppUrl : `${this.miniAppUrl}/`;
    const url = new URL(route, base);
    if (language) url.searchParams.set("lang", language);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
    return url.toString();
  }

  openAppMarkup(text = "Open Echo"): TelegramReplyMarkup {
    return { inline_keyboard: [[{ text, web_app: { url: this.miniAppHref() } }]] };
  }

  notebookKeyboard(language: LanguageCode): TelegramReplyMarkup {
    return {
      keyboard: [
        [{ text: "Tutor" }, { text: "Prepare cards" }],
        [{ text: "Open Echo", web_app: { url: this.miniAppHref("tutor/notebook", language) } }, { text: "Language" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  tutorKeyboard(language: LanguageCode): TelegramReplyMarkup {
    return {
      keyboard: [
        [{ text: "New Tutor" }, { text: "Notebook" }],
        [{ text: "Finish & review" }, { text: "Open Echo", web_app: { url: this.miniAppHref("tutor", language) } }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }

  keyboard(mode: "notebook" | "tutor", language: LanguageCode) {
    return mode === "tutor" ? this.tutorKeyboard(language) : this.notebookKeyboard(language);
  }

  noteActions(language: LanguageCode, noteId: string): TelegramReplyMarkup {
    return { inline_keyboard: [[
      { text: "Open Notebook", web_app: { url: this.miniAppHref("tutor/notebook", language) } },
      { text: "Delete note", callback_data: `delete:${noteId}` },
    ]] };
  }

  reviewMarkup(route: string, language: LanguageCode, extra: Record<string, string> = {}): TelegramReplyMarkup {
    return { inline_keyboard: [[{
      text: "Review cards",
      web_app: { url: this.miniAppHref(route, language, extra) },
    }]] };
  }
}
