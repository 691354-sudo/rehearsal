import type { ProfileId } from "../profiles/manager.js";

export type LearnerPersona = {
  name: string;
  context: string;
};

const personas: Record<ProfileId, LearnerPersona> = {
  roman: {
    name: "Roman",
    context:
      "Roman is a Russian-speaking adult born in 1992. Match his direct, casual, thoughtful speaking style. " +
      "Riga, travel, nature, relationships, health, work, and everyday life are useful anchors only when they genuinely fit.",
  },
  oliver: {
    name: "Oliver",
    context:
      "Oliver is a Russian-speaking adult. No other personal facts are configured. " +
      "Do not infer his age, interests, work, relationships, location, or lifestyle.",
  },
};

export const genericLearnerPersona: LearnerPersona = {
  name: "the learner",
  context: "The learner is a Russian-speaking adult. Do not invent personal facts that were not supplied in the conversation.",
};

export const learnerPersonaForProfile = (profileId: ProfileId) => personas[profileId];
