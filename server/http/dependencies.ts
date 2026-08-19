import type { RehearsalRepository } from "../db/repository.js";
import type { ElevenLabsService } from "../services/elevenlabs.js";
import type { OpenAIService } from "../services/openai.js";
import type { TutorService } from "../services/tutor.js";

export type HttpDependencies = {
  repository: RehearsalRepository;
  openai: OpenAIService;
  elevenlabs: ElevenLabsService;
  tutor: TutorService;
};
