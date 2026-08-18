export type LanguageCode = "en" | "lv";

export type PracticeMode = "recall" | "shadow" | "listen";

export type PracticeItem = {
  id: string;
  language: LanguageCode;
  cue: string;
  target: string;
  acceptedAnswers?: string[];
  note?: string;
  source: string;
  status: "new" | "learning" | "strong";
};

export type PlaybackOrder = "target" | "cue-target" | "target-cue";

export type SortMode = "original" | "weak-first" | "new-first" | "shuffle";

export type PracticeSettings = {
  repetitions: number;
  phrasePauseMs: number;
  languagePauseMs: number;
  playbackRate: number;
  textScale: "compact" | "regular" | "large";
  playbackOrder: PlaybackOrder;
  sortMode: SortMode;
  autoAdvance: boolean;
  loopQueue: boolean;
  showTranslation: boolean;
};

export type DiffToken = {
  value: string;
  status: "match" | "missing" | "extra";
};

export type AttemptEvaluation = {
  expected: string;
  accuracy: number;
  expectedTokens: DiffToken[];
  answerTokens: DiffToken[];
  verdict: "exact" | "close" | "retry";
};
