import type { FastifyRequest } from "fastify";
import { RehearsalRepository } from "../db/repository.js";
import { ProfileManager, type ProfileId } from "../profiles/manager.js";
import { ElevenLabsService } from "../services/elevenlabs.js";
import { genericLearnerPersona, learnerPersonaForProfile } from "../services/learner-persona.js";
import { OpenAIService } from "../services/openai.js";
import { TutorService } from "../services/tutor.js";

export type HttpContext = {
  profileId: ProfileId | null;
  repository: RehearsalRepository;
  openai: OpenAIService;
  elevenlabs: ElevenLabsService;
  tutor: TutorService;
};

export type HttpDependencies = {
  profiles: ProfileManager | null;
  bindProfile: (request: FastifyRequest, profileId: ProfileId) => void;
  forRequest: (request: FastifyRequest) => HttpContext;
  health: () => Array<{ id: ProfileId | "legacy"; ok: boolean }>;
};

export type ServiceOverrides = {
  openai?: OpenAIService;
  elevenlabs?: ElevenLabsService;
};

const makeContext = (
  repository: RehearsalRepository,
  profileId: ProfileId | null,
  overrides: ServiceOverrides = {},
): HttpContext => {
  repository.library.runTopicBackfillMigration();
  const learner = profileId ? learnerPersonaForProfile(profileId) : genericLearnerPersona;
  const openai = overrides.openai || new OpenAIService(repository, learner);
  const elevenlabs = overrides.elevenlabs || new ElevenLabsService(repository);
  return {
    profileId,
    repository,
    openai,
    elevenlabs,
    tutor: new TutorService(repository, openai),
  };
};

export const createHttpDependencies = (
  runtime: RehearsalRepository | ProfileManager,
  overrides: ServiceOverrides = {},
): HttpDependencies => {
  const profiles = runtime instanceof ProfileManager ? runtime : null;
  const requestContexts = new WeakMap<FastifyRequest, HttpContext>();
  const profileContexts = new Map<ProfileId, HttpContext>();
  const legacyContext = profiles ? null : makeContext(runtime as RehearsalRepository, null, overrides);

  const contextForProfile = (profileId: ProfileId) => {
    const existing = profileContexts.get(profileId);
    if (existing) return existing;
    const context = makeContext(profiles!.get(profileId).repository, profileId);
    profileContexts.set(profileId, context);
    return context;
  };

  return {
    profiles,
    bindProfile: (request, profileId) => requestContexts.set(request, contextForProfile(profileId)),
    forRequest: (request) => {
      const context = legacyContext || requestContexts.get(request);
      if (!context) throw new Error("PROFILE_SESSION_REQUIRED");
      return context;
    },
    health: () => profiles?.health() || [{
      id: "legacy",
      ok: (runtime as RehearsalRepository).system.quickCheck(),
    }],
  };
};
