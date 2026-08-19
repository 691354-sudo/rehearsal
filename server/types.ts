export type LanguageCode = "en" | "lv";

export type ItemKind = "phrase" | "island_line" | "correction" | "story_line";
export type ItemStatus = "new" | "learning" | "strong";
export type ItemPreference = "like" | "neutral" | "dislike";
export type FrequencyBand = "core" | "common" | "specific" | "rare";
export type LanguageCurrency = "current" | "contextual" | "dated" | "uncertain";
export type ReviewBatchKind = "chat_review" | "vocab" | "text_import" | "pattern_drill" | "capture";
export type ReviewBatchStatus = "draft" | "committed";
export type CaptureNoteStatus = "transcribing" | "ready" | "batched" | "processed" | "failed";

export type IslandSummary = {
  publicId: string;
  language: LanguageCode;
  title: string;
  description: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Island = IslandSummary & {
  items: LearningItem[];
};

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

export type LearningItem = Required<
  Pick<LearningItemInput, "language" | "cue" | "target">
> & {
  id: number;
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
  createdAt: string;
  updatedAt: string;
};

export type SearchResult = LearningItem & {
  score: number;
  match: "keyword" | "semantic" | "hybrid";
};
