import type { ReviewCandidate } from "../types.js";

export const reviewCandidate = (overrides: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  id: "9ad9bdcb-8309-43cd-8e75-92ed741bb501",
  target: "Could you give me a moment?",
  cue: "Можешь дать мне минуту?",
  note: "",
  category: "conversation",
  focusTerms: ["give me a moment"],
  disposition: "active",
  frequencyBand: "common",
  currency: "current",
  personaFit: 5,
  naturalness: 5,
  commonness: 5,
  ...overrides,
});
