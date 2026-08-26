type TelegramUser = { id: number };
type TelegramChat = { id: number; type: string };

export type TelegramFile = { file_id: string; file_size?: number };
export type TelegramDocument = TelegramFile & { file_name?: string; mime_type?: string };

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: TelegramFile & { mime_type?: string };
  audio?: TelegramFile & { mime_type?: string };
  video_note?: TelegramFile;
  video?: TelegramFile & { mime_type?: string };
  document?: TelegramDocument;
  photo?: TelegramFile[];
  animation?: TelegramFile;
  sticker?: TelegramFile;
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramReplyMarkup = Record<string, unknown>;

export interface TelegramBotClient {
  sendMessage(chatId: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<{ message_id: number }>;
  editMessageText(chatId: string, messageId: number, text: string, replyMarkup?: TelegramReplyMarkup): Promise<void>;
  sendChatAction(chatId: string, action: "typing"): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  download(fileId: string): Promise<{ bytes: Buffer; mime?: string; filename?: string }>;
}
