import type { RehearsalDatabase } from "../database.js";

export class AudioRepository {
  constructor(private readonly db: RehearsalDatabase) {}

  get(cacheKey: string) {
    return this.db.prepare(
      "SELECT format, audio FROM audio_cache WHERE cache_key = ?",
    ).get(cacheKey) as { format: string; audio: Buffer } | undefined;
  }

  save(input: { cacheKey: string; model: string; voice: string; format: string; audio: Buffer }) {
    this.db.prepare(
      `INSERT INTO audio_cache(cache_key, model, voice, format, audio)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET audio = excluded.audio, created_at = CURRENT_TIMESTAMP`,
    ).run(input.cacheKey, input.model, input.voice, input.format, input.audio);
  }
}
