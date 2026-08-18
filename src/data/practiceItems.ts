import type { LanguageCode, PracticeItem, PracticeSettings } from "../types/practice";

export const languageMeta: Record<
  LanguageCode,
  { label: string; shortLabel: string; locale: string }
> = {
  en: { label: "English", shortLabel: "EN", locale: "en-US" },
  lv: { label: "Latviešu", shortLabel: "LV", locale: "lv-LV" },
};

export const practiceItems: Record<LanguageCode, PracticeItem[]> = {
  en: [
    {
      id: "en-drawn-to",
      language: "en",
      cue: "Меня всегда тянуло к местам рядом с океаном.",
      target: "I've always been drawn to places near the ocean.",
      acceptedAnswers: ["I have always been drawn to places near the ocean."],
      note: "be drawn to — естественный способ сказать, что тебя что-то сильно привлекает",
      source: "Date conversation",
      status: "learning",
    },
    {
      id: "en-hard-to",
      language: "en",
      cue: "Мне трудно наслаждаться многолюдными местами, когда я трезвый.",
      target: "I find it hard to enjoy crowded places when I'm sober.",
      source: "Date conversation",
      status: "learning",
    },
    {
      id: "en-bucket-list",
      language: "en",
      cue: "Это уже давно в моём списке желаний.",
      target: "It's been on my bucket list for a while.",
      source: "Core islands",
      status: "new",
    },
    {
      id: "en-follow-through",
      language: "en",
      cue: "Я хотел доказать себе, что могу довести дело до конца.",
      target: "I wanted to prove to myself that I could follow through.",
      source: "Date conversation",
      status: "strong",
    },
    {
      id: "en-way-see-it",
      language: "en",
      cue: "Как я это вижу, ежедневная практика важнее изучения правил.",
      target: "The way I see it, daily practice matters more than studying rules.",
      source: "Core islands",
      status: "new",
    },
  ],
  lv: [
    {
      id: "lv-learning",
      language: "lv",
      cue: "Я учу латышский язык.",
      target: "Es mācos latviešu valodu.",
      source: "Latvian basics",
      status: "learning",
    },
    {
      id: "lv-slower",
      language: "lv",
      cue: "Вы можете говорить медленнее?",
      target: "Vai jūs varat runāt lēnāk?",
      acceptedAnswers: ["Vai varat runāt lēnāk?"],
      source: "Latvian basics",
      status: "new",
    },
    {
      id: "lv-riga",
      language: "lv",
      cue: "Мне нравится Рига.",
      target: "Man patīk Rīga.",
      source: "Latvian basics",
      status: "strong",
    },
    {
      id: "lv-car",
      language: "lv",
      cue: "Мне не нужна машина.",
      target: "Man nevajag mašīnu.",
      source: "Latvian basics",
      status: "new",
    },
    {
      id: "lv-stop",
      language: "lv",
      cue: "Где находится ближайшая остановка?",
      target: "Kur atrodas tuvākā pietura?",
      source: "Latvian basics",
      status: "new",
    },
  ],
};

export const defaultSettings: Record<LanguageCode, PracticeSettings> = {
  en: {
    repetitions: 2,
    phrasePauseMs: 1200,
    languagePauseMs: 1600,
    playbackRate: 1,
    textScale: "regular",
    playbackOrder: "target",
    sortMode: "weak-first",
    autoAdvance: false,
    loopQueue: false,
    showTranslation: true,
  },
  lv: {
    repetitions: 3,
    phrasePauseMs: 1800,
    languagePauseMs: 2400,
    playbackRate: 0.85,
    textScale: "regular",
    playbackOrder: "cue-target",
    sortMode: "new-first",
    autoAdvance: false,
    loopQueue: false,
    showTranslation: true,
  },
};
