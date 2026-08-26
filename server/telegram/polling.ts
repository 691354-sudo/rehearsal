import type { TelegramEchoBot } from "./bot.js";
import type { TelegramHttpClient } from "./client.js";

export class TelegramPollingRuntime {
  private stopped = false;
  private activeRequest: AbortController | null = null;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly client: TelegramHttpClient,
    private readonly bot: TelegramEchoBot,
    private readonly miniAppUrl: string,
  ) {}

  async start() {
    await this.client.configure(this.miniAppUrl);
    this.loopPromise = this.poll();
  }

  async stop() {
    this.stopped = true;
    this.activeRequest?.abort();
    await this.loopPromise;
  }

  private async poll() {
    let offset = 0;
    while (!this.stopped) {
      const controller = new AbortController();
      this.activeRequest = controller;
      try {
        const updates = await this.client.getUpdates(offset, controller.signal);
        await Promise.all(updates.map((update) => this.bot.enqueue(update)));
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
        }
      } catch (error) {
        if (this.stopped) break;
        console.error(JSON.stringify({
          event: "telegram_poll_failed",
          error: error instanceof Error ? error.message : "TELEGRAM_POLL_FAILED",
        }));
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      } finally {
        if (this.activeRequest === controller) this.activeRequest = null;
      }
    }
  }
}
