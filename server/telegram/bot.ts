import type { LanguageCode } from "../../contracts/api.js";
import { isLanguageCode } from "../../contracts/api.js";
import type { ProfileManager } from "../profiles/manager.js";
import { learnerPersonaForProfile } from "../services/learner-persona.js";
import { OpenAIService } from "../services/openai.js";
import { prepareCaptureNotes } from "../services/capture-processing.js";
import { TutorService } from "../services/tutor.js";
import { audioUploadExtension } from "../http/audio-upload.js";
import { TelegramBotSupport, appendCaption, commandIs, deterministicUuid } from "./bot-support.js";
import type { TelegramBotClient, TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./types.js";

export type { TelegramBotClient, TelegramMessage, TelegramReplyMarkup, TelegramUpdate } from "./types.js";

export type BotServices = { openai: OpenAIService; tutor: TutorService };

export class TelegramEchoBot {
  private readonly queues = new Map<string, Promise<void>>();
  private readonly services = new Map<string, BotServices>();
  private readonly allowedProfiles: Set<string>;
  private readonly support: TelegramBotSupport;

  constructor(
    private readonly profiles: ProfileManager,
    private readonly client: TelegramBotClient,
    miniAppUrl: string,
    allowedProfileIds: readonly string[],
    private readonly serviceFactory?: (profileId: string) => BotServices,
  ) {
    this.allowedProfiles = new Set(allowedProfileIds);
    this.support = new TelegramBotSupport(client, miniAppUrl);
  }

  enqueue(update: TelegramUpdate) {
    const userId = update.message?.from?.id ?? update.callback_query?.from.id;
    if (!userId) return Promise.resolve();
    const key = String(userId);
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous.then(() => this.processUpdate(update)).finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    this.queues.set(key, next);
    return next;
  }

  async processUpdate(update: TelegramUpdate) {
    if (update.callback_query) return this.processCallback(update.callback_query);
    const message = update.message;
    if (!message?.from || message.chat.type !== "private") return;
    const userId = String(message.from.id);
    const chatId = String(message.chat.id);
    const found = this.profiles.telegram.get(userId);
    if (!found || !this.allowedProfiles.has(found.profileId)) {
      await this.support.sendConnect(chatId);
      return;
    }
    const binding = this.profiles.telegram.update(userId, { chatId })!.binding;
    const text = message.text?.trim() || "";

    if (commandIs(text, "start")) {
      this.profiles.telegram.update(userId, { mode: "notebook", tutorThreadId: null });
      await this.client.sendMessage(chatId, "Notebook is ready. Send a thought, voice note, audio, video, or .txt file.", this.support.notebookKeyboard(binding.language));
      return;
    }
    if (commandIs(text, "help")) {
      await this.client.sendMessage(chatId, "Notebook saves new notes by default. Tutor starts a separate Tutor session. Prepare cards creates drafts for review in Echo.", this.support.keyboard(binding.mode, binding.language));
      return;
    }
    if (commandIs(text, "app")) {
      await this.client.sendMessage(chatId, "Open the full Echo app.", this.support.openAppMarkup());
      return;
    }
    if (commandIs(text, "language") || text === "Language") {
      await this.sendLanguagePicker(chatId, found.profileId, binding.language);
      return;
    }
    if (commandIs(text, "notebook") || text === "Notebook") {
      this.profiles.telegram.update(userId, { mode: "notebook" });
      await this.client.sendMessage(chatId, "Notebook is on. New messages become notes.", this.support.notebookKeyboard(binding.language));
      return;
    }
    if (commandIs(text, "tutor") || text === "Tutor" || text === "New Tutor") {
      this.profiles.telegram.update(userId, { mode: "tutor", tutorThreadId: null });
      await this.client.sendMessage(chatId, "New Tutor session. Send your first message.", this.support.tutorKeyboard(binding.language));
      return;
    }
    if (commandIs(text, "prepare") || text === "Prepare cards") {
      await this.prepareNotebook(update, found.profileId, chatId, userId, binding.language);
      return;
    }
    if (text === "Finish & review") {
      await this.finishTutor(update, found.profileId, chatId, userId, binding.language, binding.tutorThreadId);
      return;
    }

    if (binding.mode === "tutor") {
      await this.handleTutorMessage(update, found.profileId, chatId, userId, binding.language, binding.tutorThreadId, message);
    } else {
      await this.handleNotebookMessage(update, found.profileId, chatId, userId, binding.language, message);
    }
  }

  private serviceContext(profileId: string) {
    const existing = this.services.get(profileId);
    if (existing) return existing;
    const injected = this.serviceFactory?.(profileId);
    if (injected) {
      this.services.set(profileId, injected);
      return injected;
    }
    const profile = this.profiles.get(profileId);
    const openai = new OpenAIService(profile.repository, learnerPersonaForProfile(profileId, profile.name));
    const services = {
      openai,
      tutor: new TutorService(
        profile.repository,
        openai,
        this.profiles.onboardingState(profileId).eligibility === "pilot",
      ),
    };
    this.services.set(profileId, services);
    return services;
  }

  private async processCallback(callback: TelegramCallbackQuery) {
    const message = callback.message;
    if (!message || message.chat.type !== "private") {
      await this.client.answerCallbackQuery(callback.id);
      return;
    }
    const userId = String(callback.from.id);
    const chatId = String(message.chat.id);
    const found = this.profiles.telegram.get(userId);
    if (!found || !this.allowedProfiles.has(found.profileId)) {
      await this.client.answerCallbackQuery(callback.id, "Connect Echo first.");
      return;
    }
    const data = callback.data || "";
    if (data.startsWith("lang:")) {
      const language = data.slice(5);
      const enabled = this.profiles.get(found.profileId).repository.system.listLanguages();
      if (!isLanguageCode(language) || !enabled.some((option) => option.code === language)) {
        await this.client.answerCallbackQuery(callback.id, "This language is not enabled.");
        return;
      }
      const updated = this.profiles.telegram.update(userId, {
        chatId,
        language,
        tutorThreadId: null,
      })!.binding;
      await this.client.answerCallbackQuery(callback.id, "Language changed.");
      await this.client.editMessageText(chatId, message.message_id, `Language: ${enabled.find((option) => option.code === language)?.label || language}`);
      await this.client.sendMessage(chatId, "The current Tutor session was reset for this language.", this.support.keyboard(updated.mode, language));
      return;
    }
    if (data.startsWith("delete:")) {
      const noteId = data.slice(7);
      const repository = this.profiles.get(found.profileId).repository;
      const note = repository.capture.get(noteId);
      if (!note) {
        await this.client.answerCallbackQuery(callback.id, "Note already deleted.");
        return;
      }
      if (!repository.capture.delete(noteId)) {
        await this.client.answerCallbackQuery(callback.id, "This note is already in review.");
        return;
      }
      await this.client.answerCallbackQuery(callback.id, "Note deleted.");
      await this.client.editMessageText(chatId, message.message_id, "Note deleted.");
      return;
    }
    await this.client.answerCallbackQuery(callback.id);
  }

  private async handleNotebookMessage(
    update: TelegramUpdate,
    profileId: string,
    chatId: string,
    userId: string,
    language: LanguageCode,
    message: TelegramMessage,
  ) {
    const repository = this.profiles.get(profileId).repository;
    const text = message.text?.trim();
    if (text) {
      if (text.length > 30_000) {
        await this.client.sendMessage(chatId, "This note is too long. Keep it under 30,000 characters.", this.support.notebookKeyboard(language));
        return;
      }
      const note = repository.capture.createText({
        publicId: deterministicUuid("notebook-text", userId, update.update_id),
        language,
        transcript: text,
      });
      await this.confirmNote(chatId, language, note.publicId, repository.capture.list(language).filter((candidate) => candidate.status === "ready").length);
      return;
    }
    if (message.document && this.support.isTextDocument(message.document)) {
      const file = await this.support.downloadChecked(chatId, message.document);
      if (!file) return;
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes).trim();
      } catch {
        await this.client.sendMessage(chatId, "That .txt file is not valid UTF-8 text.", this.support.notebookKeyboard(language));
        return;
      }
      const content = appendCaption(message.caption, decoded);
      if (!content || content.length > 30_000) {
        await this.client.sendMessage(chatId, "The text file must contain 1–30,000 characters.", this.support.notebookKeyboard(language));
        return;
      }
      const note = repository.capture.createText({
        publicId: deterministicUuid("notebook-text-file", userId, update.update_id),
        language,
        transcript: content,
      });
      await this.confirmNote(chatId, language, note.publicId, repository.capture.list(language).filter((candidate) => candidate.status === "ready").length);
      return;
    }
    const media = this.support.audioMedia(message);
    if (media) {
      const file = await this.support.downloadChecked(chatId, media.file);
      if (!file) return;
      const mime = (media.mime || file.mime || "").toLocaleLowerCase().split(";")[0];
      const extension = audioUploadExtension(mime);
      if (!extension) {
        await this.support.unsupported(chatId, language);
        return;
      }
      const publicId = deterministicUuid("notebook-media", userId, update.update_id);
      const existing = repository.capture.get(publicId);
      const note = existing || repository.capture.create({
        publicId,
        language,
        audio: file.bytes,
        audioMime: mime,
        transcript: message.caption,
      });
      if (note.status === "transcribing") {
        try {
          const transcript = await this.serviceContext(profileId).openai.transcribe({
            audio: file.bytes,
            audioMime: mime,
            filename: file.filename || `telegram-note.${extension}`,
          });
          repository.capture.completeTranscription(publicId, transcript);
        } catch (error) {
          repository.capture.failTranscription(publicId, error instanceof Error ? error.message : "TRANSCRIPTION_FAILED");
          await this.client.sendMessage(chatId, "I couldn't transcribe this recording. It is saved in Notebook for Retry or Delete.", this.support.noteActions(language, publicId));
          return;
        }
      }
      if (note.status === "failed") {
        await this.client.sendMessage(chatId, "This recording is already saved in Notebook and still needs Retry or Delete.", this.support.noteActions(language, publicId));
        return;
      }
      await this.confirmNote(chatId, language, publicId, repository.capture.list(language).filter((candidate) => candidate.status === "ready").length);
      return;
    }
    const caption = message.caption?.trim();
    if (caption) {
      if (caption.length > 30_000) {
        await this.client.sendMessage(chatId, "This caption is too long. Keep it under 30,000 characters.", this.support.notebookKeyboard(language));
        return;
      }
      const note = repository.capture.createText({
        publicId: deterministicUuid("notebook-caption", userId, update.update_id),
        language,
        transcript: caption,
      });
      const readyCount = repository.capture.list(language).filter((candidate) => candidate.status === "ready").length;
      await this.client.sendMessage(chatId,
        `The attachment is not supported, but its caption was saved to Notebook. ${readyCount} ready ${readyCount === 1 ? "note" : "notes"}.`,
        this.support.noteActions(language, note.publicId));
      return;
    }
    await this.support.unsupported(chatId, language);
  }

  private async handleTutorMessage(
    update: TelegramUpdate,
    profileId: string,
    chatId: string,
    userId: string,
    language: LanguageCode,
    threadId: string | null,
    message: TelegramMessage,
  ) {
    let content = message.text?.trim() || "";
    if (!content && message.document && this.support.isTextDocument(message.document)) {
      const file = await this.support.downloadChecked(chatId, message.document);
      if (!file) return;
      try {
        content = appendCaption(message.caption, new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
      } catch {
        await this.client.sendMessage(chatId, "That .txt file is not valid UTF-8 text.", this.support.tutorKeyboard(language));
        return;
      }
    } else if (!content) {
      const media = this.support.audioMedia(message);
      if (!media) {
        await this.support.unsupported(chatId, language, "tutor");
        return;
      }
      const file = await this.support.downloadChecked(chatId, media.file);
      if (!file) return;
      const mime = (media.mime || file.mime || "").toLocaleLowerCase().split(";")[0];
      const extension = audioUploadExtension(mime);
      if (!extension) {
        await this.support.unsupported(chatId, language, "tutor");
        return;
      }
      try {
        const transcript = await this.serviceContext(profileId).openai.transcribe({
          audio: file.bytes,
          audioMime: mime,
          filename: file.filename || `telegram-tutor.${extension}`,
          languages: this.support.transcriptionLanguages(language),
          prompt: "A conversational message to a language tutor. Preserve the language and wording the speaker used.",
        });
        content = appendCaption(message.caption, transcript);
      } catch {
        await this.client.sendMessage(chatId, "I couldn't transcribe that Tutor message. Nothing was saved.", this.support.tutorKeyboard(language));
        return;
      }
    }
    content = content.trim();
    if (!content || content.length > 20_000) {
      await this.client.sendMessage(chatId, "Tutor messages must contain 1–20,000 characters.", this.support.tutorKeyboard(language));
      return;
    }
    await this.client.sendChatAction(chatId, "typing").catch(() => undefined);
    const typing = setInterval(() => void this.client.sendChatAction(chatId, "typing").catch(() => undefined), 4_000);
    try {
      const result = await this.serviceContext(profileId).tutor.chat({
        language,
        message: content,
        threadPublicId: threadId || undefined,
        clientMessageId: deterministicUuid("tutor-message", userId, update.update_id),
      });
      this.profiles.telegram.update(userId, { mode: "tutor", tutorThreadId: result.threadId });
      await this.support.sendLongMessage(chatId, result.content, this.support.tutorKeyboard(language));
    } catch {
      await this.client.sendMessage(chatId, "Tutor is unavailable right now. Retry this message in a moment.", this.support.tutorKeyboard(language));
    } finally {
      clearInterval(typing);
    }
  }

  private async prepareNotebook(
    update: TelegramUpdate,
    profileId: string,
    chatId: string,
    userId: string,
    language: LanguageCode,
  ) {
    const pending = await this.client.sendMessage(chatId, "Preparing cards…", this.support.notebookKeyboard(language));
    try {
      const profile = this.profiles.get(profileId);
      const result = await prepareCaptureNotes({
        repository: profile.repository,
        openai: this.serviceContext(profileId).openai,
        language,
        batchPublicId: deterministicUuid("notebook-review", userId, update.update_id),
      });
      const count = result.batch.candidates.length;
      await this.client.editMessageText(
        chatId,
        pending.message_id,
        count ? `${count} card ${count === 1 ? "draft" : "drafts"} ready. Nothing has been added to Library.`
          : "The notes are in review, but no card drafts were generated.",
        this.support.reviewMarkup("tutor/notebook", language),
      );
    } catch (error) {
      const noNotes = error instanceof Error && error.message === "NO_READY_CAPTURES";
      await this.client.editMessageText(chatId, pending.message_id, noNotes
        ? "There are no ready Notebook notes to prepare."
        : "Cards could not be prepared. Your Notebook notes are unchanged.");
    }
  }

  private async finishTutor(
    update: TelegramUpdate,
    profileId: string,
    chatId: string,
    userId: string,
    language: LanguageCode,
    threadId: string | null,
  ) {
    if (!threadId) {
      await this.client.sendMessage(chatId, "Start a Tutor session before preparing a review.", this.support.tutorKeyboard(language));
      return;
    }
    const pending = await this.client.sendMessage(chatId, "Preparing Tutor review…", this.support.tutorKeyboard(language));
    try {
      const result = await this.serviceContext(profileId).tutor.review(
        threadId,
        deterministicUuid("tutor-review", userId, update.update_id),
      );
      if (!result) throw new Error("THREAD_NOT_FOUND");
      const count = result.batch.candidates.length;
      await this.client.editMessageText(chatId, pending.message_id,
        count ? `${count} card ${count === 1 ? "draft" : "drafts"} ready. Nothing has been added to Library.`
          : "The Tutor review is ready, but no card drafts were generated.",
        this.support.reviewMarkup("tutor", language, { thread: threadId, review: result.batch.publicId }));
    } catch {
      await this.client.editMessageText(chatId, pending.message_id, "Tutor review could not be prepared. Nothing was added to Library.");
    }
  }

  private async sendLanguagePicker(chatId: string, profileId: string, current: LanguageCode) {
    const languages = this.profiles.get(profileId).repository.system.listLanguages();
    await this.client.sendMessage(chatId, `Current language: ${languages.find((option) => option.code === current)?.label || current}`, {
      inline_keyboard: languages.map((language) => [{
        text: `${language.code === current ? "✓ " : ""}${language.label}`,
        callback_data: `lang:${language.code}`,
      }]),
    });
  }

  private async confirmNote(chatId: string, language: LanguageCode, noteId: string, readyCount: number) {
    await this.client.sendMessage(chatId,
      `Saved to Notebook. ${readyCount} ready ${readyCount === 1 ? "note" : "notes"}.`,
      this.support.noteActions(language, noteId));
  }
}
