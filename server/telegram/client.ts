import type { TelegramBotClient, TelegramReplyMarkup, TelegramUpdate } from "./types.js";

type TelegramApiResponse<T> = { ok: boolean; result?: T; description?: string };
type TelegramFileResult = { file_path?: string; file_size?: number };

export class TelegramHttpClient implements TelegramBotClient {
  constructor(private readonly token: string) {}

  async call<T>(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch {
      throw new Error(`TELEGRAM_API_${method.toUpperCase()}_FAILED`);
    }
    const result = await response.json().catch(() => null) as TelegramApiResponse<T> | null;
    if (!response.ok || !result?.ok || result.result === undefined) {
      throw new Error(`TELEGRAM_API_${method.toUpperCase()}_FAILED`);
    }
    return result.result;
  }

  sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup) {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async editMessageText(chatId: string, messageId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  }

  async sendChatAction(chatId: string, action: "typing") {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string) {
    await this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async download(fileId: string) {
    const file = await this.call<TelegramFileResult>("getFile", { file_id: fileId });
    if (!file.file_path || (file.file_size && file.file_size > 20 * 1024 * 1024)) {
      throw new Error("TELEGRAM_FILE_UNAVAILABLE");
    }
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    } catch {
      throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
    }
    if (!response.ok) throw new Error("TELEGRAM_FILE_DOWNLOAD_FAILED");
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get("content-type") || undefined,
      filename: file.file_path.split("/").pop(),
    };
  }

  getUpdates(offset: number, signal: AbortSignal) {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message", "callback_query"],
    }, signal);
  }

  async configure(miniAppUrl: string) {
    await this.call("deleteWebhook", { drop_pending_updates: false });
    await this.call("setMyCommands", { commands: [
      { command: "start", description: "Open Notebook" },
      { command: "notebook", description: "Save messages as notes" },
      { command: "tutor", description: "Start a new Tutor session" },
      { command: "prepare", description: "Prepare Notebook card drafts" },
      { command: "language", description: "Change learning language" },
      { command: "app", description: "Open Echo Mini App" },
      { command: "help", description: "How this bot works" },
    ] });
    await this.call("setChatMenuButton", {
      menu_button: { type: "web_app", text: "Open Echo", web_app: { url: miniAppUrl } },
    });
  }
}
