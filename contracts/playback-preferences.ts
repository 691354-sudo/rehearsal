import { z } from "zod";

export const playbackPreferencesSchema = z.object({
  provider: z.enum(["openai", "elevenlabs"]),
  repetitions: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
  speed: z.number().min(0.5).max(1.5),
  playAfterRecall: z.boolean(),
  voice: z.string().min(1).max(100),
  elevenlabs: z.object({
    voiceId: z.string().max(100),
    modelId: z.enum(["eleven_multilingual_v2", "eleven_flash_v2_5"]),
  }).strict(),
}).strict();
export const playbackPatchSchema = playbackPreferencesSchema.partial().extend({
  elevenlabs: playbackPreferencesSchema.shape.elevenlabs.partial().optional(),
});
export type AccountPlaybackPreferences = z.infer<typeof playbackPreferencesSchema>;
export type PlaybackPatch = z.infer<typeof playbackPatchSchema>;

export const mergePlayback = (current: Omit<AccountPlaybackPreferences, "repetitions"> & { repetitions: number }, patch: PlaybackPatch) => ({
  ...current, ...patch, elevenlabs: { ...current.elevenlabs, ...patch.elevenlabs },
});
