import type { LanguageCode } from "../../contracts/api.js";
import type { RehearsalRepository } from "../db/repository.js";
import type { OpenAIService } from "./openai.js";

export const prepareCaptureNotes = async (input: {
  repository: RehearsalRepository;
  openai: OpenAIService;
  language: LanguageCode;
  batchPublicId?: string;
}) => {
  const activeBatch = input.repository.capture.getActiveBatch(input.language);
  if (activeBatch) return { batch: activeBatch, existing: true, remaining: 0 };
  const selection = input.repository.capture.selectReady(input.language, 50_000);
  if (!selection.notes.length) throw new Error("NO_READY_CAPTURES");
  const prepared = await input.openai.prepareCaptureBatch({
    language: input.language,
    notes: selection.notes,
    publicId: input.batchPublicId,
  });
  input.repository.capture.attachToBatch(
    selection.notes.map((note) => note.publicId),
    prepared.batch.publicId,
  );
  input.repository.library.saveSource({
    publicId: input.batchPublicId,
    language: input.language,
    title: "Capture Reality",
    rawText: selection.notes.map((note) => note.transcript).join("\n\n"),
    kind: "capture_notebook",
    metadata: {
      captureNoteIds: selection.notes.map((note) => note.publicId),
      batchId: prepared.batch.publicId,
    },
  });
  return { ...prepared, existing: false, remaining: selection.remaining };
};
