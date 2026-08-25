export type LanguageCode = "en" | "lv" | "vi" | "no";
export type LanguageOption = {
  code: LanguageCode;
  label: string;
  locale: string;
  capabilities: { audio: boolean };
};

export const languageCatalog = {
  en: { code: "en", label: "English", locale: "en-US", capabilities: { audio: true } },
  lv: { code: "lv", label: "Latviešu", locale: "lv-LV", capabilities: { audio: false } },
  vi: { code: "vi", label: "Vietnamese", locale: "vi-VN", capabilities: { audio: true } },
  no: { code: "no", label: "Norwegian", locale: "nb-NO", capabilities: { audio: true } },
} as const satisfies Record<LanguageCode, LanguageOption>;

export const languageCodes = Object.keys(languageCatalog) as LanguageCode[];
export const isLanguageCode = (value: unknown): value is LanguageCode =>
  typeof value === "string" && Object.hasOwn(languageCatalog, value);
export type ItemKind = "phrase" | "island_line" | "correction" | "story_line";
export type ItemStatus = "new" | "learning" | "strong";
export type ItemPreference = "like" | "neutral" | "dislike";
export type FrequencyBand = "core" | "common" | "specific" | "rare";
export type LanguageCurrency = "current" | "contextual" | "dated" | "uncertain";
export type ReviewBatchKind = "chat_review" | "vocab" | "text_import" | "pattern_drill" | "capture";
export type ReviewBatchStatus = "draft" | "committed";
export type ReviewRating = "again" | "hard" | "good" | "easy";
export type CaptureNoteStatus = "transcribing" | "ready" | "batched" | "processed" | "failed";

export type ReviewCandidate = {
  id: string;
  target: string;
  cue: string;
  note: string;
  category: string;
  focusTerms: string[];
  pattern?: string;
  disposition?: "active" | "recognition" | "skip";
  frequencyBand: FrequencyBand;
  currency: LanguageCurrency;
  personaFit: number;
  naturalness: number;
  commonness: number;
};

export type ReviewBatch = {
  publicId: string;
  language: LanguageCode;
  kind: ReviewBatchKind;
  title: string;
  sourceText: string;
  candidates: ReviewCandidate[];
  status: ReviewBatchStatus;
  sourceThreadPublicId: string | null;
  destinationTopicTitle: string | null;
  createdAt: string;
  updatedAt: string;
  committedAt: string | null;
};

export type LearningItemInput = {
  publicId?: string;
  language: LanguageCode;
  kind?: ItemKind;
  cue: string;
  target: string;
  acceptedAnswers?: string[];
  note?: string;
  source?: string;
  status?: ItemStatus;
  preference?: ItemPreference;
  naturalness?: number;
  commonness?: number;
  register?: "casual" | "neutral" | "formal";
  tags?: string[];
  focusTerms?: string[];
  frequencyBand?: FrequencyBand;
  currency?: LanguageCurrency;
  personaFit?: number;
  relevanceCheckedAt?: string | null;
  practiceEnabled?: boolean;
};

export type ReviewSchedule = {
  state: "new" | "learning" | "review" | "relearning";
  dueAt: string;
  retrievability: number | null;
  options: Record<ReviewRating, { dueAt: string; intervalSeconds: number }>;
};

export type LearningStage = "new" | "learning" | "due" | "strong" | "learned";
export type LearningProgress = {
  stage: LearningStage;
  recalls: number;
  listens: number;
};
export type LearningProgressSummary = Record<LearningStage, number> & {
  dueNow: number;
  recalls: number;
  listens: number;
};

export type LearningItem = Required<Pick<LearningItemInput, "language" | "cue" | "target">> & {
  id?: number;
  publicId: string;
  kind: ItemKind;
  acceptedAnswers: string[];
  note: string;
  source: string;
  status: ItemStatus;
  preference: ItemPreference;
  naturalness: number;
  commonness: number;
  register: "casual" | "neutral" | "formal";
  tags: string[];
  focusTerms: string[];
  frequencyBand: FrequencyBand;
  currency: LanguageCurrency;
  personaFit: number;
  relevanceCheckedAt: string | null;
  practiceEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  schedule?: ReviewSchedule;
  progress: LearningProgress;
};

export type IslandSummary = {
  publicId: string;
  language: LanguageCode;
  title: string;
  description: string;
  itemCount: number;
  progress: LearningProgressSummary;
  createdAt: string;
  updatedAt: string;
};

export type Island = IslandSummary & { items: LearningItem[] };

export type CaptureNote = {
  publicId: string;
  language: LanguageCode;
  transcript: string;
  audioMime: string;
  status: CaptureNoteStatus;
  error: string;
  reviewBatchPublicId: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

export type SearchResult = LearningItem & {
  score: number;
  match: "keyword" | "semantic" | "hybrid";
};

export type ChatThread = {
  publicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type SchedulerSettings = {
  presets: Record<ItemPreference, { requestRetention: number; maximumInterval: number }>;
  learningSteps: string[];
  relearningSteps: string[];
  fuzz: boolean;
  newItemsPerDay: number;
};

export type DailyProgress = { recall: number; shadow: number; pattern: number };

export type ProfileId = string;
export type ProfileSummary = { id: ProfileId; name: string };
export type InvitationPurpose = "standard" | "onboarding_v1_pilot";
export type OnboardingState = {
  version: 1;
  eligibility: "none" | "pilot";
  status: "not_available" | "pending" | "completed";
  language?: LanguageCode;
  starterReady: boolean;
  starterTutorThreadId?: string;
  completedAt?: string;
};
export type AuthSession = {
  profile: ProfileSummary;
  csrfToken: string;
  availableLanguages: LanguageOption[];
  onboarding: OnboardingState;
};
