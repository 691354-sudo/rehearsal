import { z } from "zod";
import type { LanguageCode } from "../types.js";
import type { RehearsalDatabase } from "./database.js";
import { RehearsalRepository } from "./repository.js";

const replacementCardSchema = z.object({
  target: z.string().trim().min(1).max(500),
  cue: z.string().trim().min(1).max(500),
  note: z.string().trim().max(300).default(""),
  category: z.string().trim().min(1).max(80),
  focusTerms: z.array(z.string().trim().min(1).max(100)).max(4).default([]),
  frequencyBand: z.enum(["core", "common", "specific"]),
  naturalness: z.number().int().min(1).max(5),
  commonness: z.number().int().min(1).max(5),
  personaFit: z.number().int().min(1).max(5),
});

const normalized = (value: string) => value.toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const libraryReplacementSchema = z.object({
  version: z.literal(1),
  language: z.enum(["en", "lv"]),
  title: z.string().trim().min(1).max(300),
  generatedAt: z.string().datetime(),
  cards: z.array(replacementCardSchema).min(1).max(2_000),
}).superRefine(({ cards }, context) => {
  for (const field of ["target", "cue"] as const) {
    const seen = new Set<string>();
    cards.forEach((card, index) => {
      const key = normalized(card[field]);
      if (seen.has(key)) context.addIssue({
        code: "custom",
        message: `Duplicate normalized ${field}`,
        path: ["cards", index, field],
      });
      seen.add(key);
    });
  }
});

export type LibraryReplacement = z.infer<typeof libraryReplacementSchema>;

export const replaceLibrary = (db: RehearsalDatabase, input: LibraryReplacement) => {
  const repository = new RehearsalRepository(db);
  const count = (table: "items" | "islands", language: LanguageCode) =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE language_code = ?`)
      .get(language) as { count: number }).count;
  const before = { items: count("items", input.language), topics: count("islands", input.language) };
  const transaction = db.transaction(() => {
    for (const topic of repository.library.listIslands(input.language)) {
      repository.library.deleteIsland(topic.publicId);
    }
    const oldIds = (db.prepare("SELECT public_id FROM items WHERE language_code = ?")
      .all(input.language) as Array<{ public_id: string }>).map((row) => row.public_id);
    if (oldIds.length) repository.items.deleteMany(oldIds);

    const topics = new Map<string, string[]>();
    for (const card of input.cards) {
      const item = repository.items.save({
        language: input.language,
        kind: "phrase",
        cue: card.cue,
        target: card.target,
        note: card.note,
        source: input.title,
        status: "new",
        preference: "neutral",
        naturalness: card.naturalness,
        commonness: card.commonness,
        register: "neutral",
        tags: card.focusTerms,
        focusTerms: card.focusTerms,
        frequencyBand: card.frequencyBand,
        currency: "current",
        personaFit: card.personaFit,
        relevanceCheckedAt: input.generatedAt,
        practiceEnabled: true,
      }, "system");
      const itemIds = topics.get(card.category) || [];
      itemIds.push(item.publicId);
      topics.set(card.category, itemIds);
    }
    for (const [title, itemPublicIds] of topics) {
      repository.library.createIsland({
        language: input.language,
        title,
        description: "Curated speaking foundation",
        itemPublicIds,
      }, "system");
    }
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("FOREIGN_KEY_CHECK_FAILED");
  });
  transaction();
  return {
    before,
    after: { items: count("items", input.language), topics: count("islands", input.language) },
  };
};
