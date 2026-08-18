import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight, Check, ChevronDown, ChevronRight, FilePlus2, LoaderCircle,
  Moon, PanelLeft, Pencil, Play, Plus, Search, Send, Settings2, Trash2,
  Sparkles, Sun, ThumbsDown, ThumbsUp, Upload, Volume2, WandSparkles, X,
} from "lucide-react";
import "@fontsource-variable/inter";
import { useSpeech } from "../hooks/useSpeech";
import { evaluateAttempt } from "../lib/compare";
import {
  moveReviewRating,
  moveReviewedItem,
  reviewRatings,
  type ReviewRating,
} from "../lib/sessionQueue";
import type { DiffToken } from "../types/practice";
import { ReviewBatchPanel, type ReviewBatch } from "./ReviewBatchPanel";
import "./design-lab.css";

type Mode = "recall" | "shadow";
type Theme = "light" | "dark";
type Route = "practice" | "tutor" | "library";
type Language = "en" | "lv";
type ItemPreference = "like" | "neutral" | "dislike";
type LearningItem = {
  publicId: string;
  language: Language;
  cue: string;
  target: string;
  acceptedAnswers?: string[];
  note: string;
  source: string;
  status: "new" | "learning" | "strong";
  preference: ItemPreference;
  tags: string[];
  frequencyBand?: "core" | "common" | "specific" | "rare";
  currency?: "current" | "contextual" | "dated" | "uncertain";
  personaFit?: number;
  practiceEnabled?: boolean;
  schedule?: {
    state: "new" | "learning" | "review" | "relearning";
    dueAt: string;
    retrievability: number | null;
    options: Record<ReviewRating, { dueAt: string; intervalSeconds: number }>;
  };
};
type Evaluation = {
  score: number;
  verdict: "exact" | "close" | "retry";
  naturalAnswer: string;
  correctedAnswer: string;
  summaryRu: string;
  mistakes: Array<{ original: string; correction: string; explanationRu: string }>;
  expectedTokens?: DiffToken[];
  answerTokens?: DiffToken[];
};
type AttemptDraft = { answer: string; evaluation?: Evaluation };
type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type ChatThread = {
  publicId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};
type TtsProvider = "openai" | "elevenlabs";
type ElevenLabsPreferences = {
  modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
};
type PlaybackPreferences = {
  provider: TtsProvider;
  repetitions: number;
  speed: number;
  pauseMs: number;
  voice: string;
  elevenlabs: ElevenLabsPreferences;
};
type ElevenLabsConfig = {
  configured: boolean;
  voice: { id: string; name: string };
  models: ElevenLabsPreferences["modelId"][];
  defaults: ElevenLabsPreferences & { speed: number };
  note: string;
};
type SchedulerSettings = {
  presets: Record<ItemPreference, { requestRetention: number; maximumInterval: number }>;
  learningSteps: string[];
  relearningSteps: string[];
  fuzz: boolean;
  newItemsPerDay: number;
};
type DailyProgress = { recall: number; shadow: number; pattern: number };

const defaultPlayback: PlaybackPreferences = {
  provider: "openai",
  repetitions: 2,
  speed: 1,
  pauseMs: 1500,
  voice: "marin",
  elevenlabs: {
    modelId: "eleven_multilingual_v2",
    stability: 0.45,
    similarityBoost: 0.6,
    style: 0.02,
    speakerBoost: true,
  },
};

const defaultElevenLabsConfig: ElevenLabsConfig = {
  configured: false,
  voice: { id: "1YGgSmpRGVzkcaI7zhbX", name: "Christopher" },
  models: ["eleven_multilingual_v2", "eleven_flash_v2_5"],
  defaults: { ...defaultPlayback.elevenlabs, speed: 1.05 },
  note: "Library voices require a paid ElevenLabs API plan.",
};

const defaultSchedulerSettings: SchedulerSettings = {
  presets: {
    like: { requestRetention: 0.93, maximumInterval: 60 },
    neutral: { requestRetention: 0.9, maximumInterval: 180 },
    dislike: { requestRetention: 0.87, maximumInterval: 365 },
  },
  learningSteps: ["1m", "10m"],
  relearningSteps: ["1m", "10m"],
  fuzz: true,
  newItemsPerDay: 10,
};

const defaultVoices = [
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
  "onyx", "sage", "shimmer", "verse", "marin", "cedar",
];

const languageCopy = {
  en: { short: "EN", label: "English", locale: "en-US" },
  lv: { short: "LV", label: "Latviešu", locale: "lv-LV" },
} as const;

const apiPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

const fallbackItems: Record<Language, LearningItem[]> = {
  en: [{
    publicId: "en-drawn-to", language: "en",
    cue: "Меня всегда тянуло к местам рядом с океаном.",
    target: "I've always been drawn to places near the ocean.",
    note: "be drawn to — естественный способ сказать, что тебя к чему-то тянет",
    source: "Date conversation", status: "learning", preference: "neutral", tags: ["island", "nature"],
  }],
  lv: [{
    publicId: "lv-learning", language: "lv", cue: "Я учу латышский язык.",
    target: "Es mācos latviešu valodu.", note: "", source: "Latvian starter set",
    status: "learning", preference: "neutral", tags: ["basics"],
  }],
};

export function DesignLab() {
  const [route, setRoute] = useState<Route>("practice");
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem("rehearsal:language") === "lv" ? "lv" : "en",
  );
  const [mode, setMode] = useState<Mode>("recall");
  const [attempts, setAttempts] = useState<Record<string, AttemptDraft>>({});
  const [revealedItems, setRevealedItems] = useState<string[]>([]);
  const [items, setItems] = useState<LearningItem[]>(fallbackItems[language]);
  const [activeItemId, setActiveItemId] = useState(fallbackItems[language][0].publicId);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>({ recall: 0, shadow: 0, pattern: 0 });
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("rehearsal:playback") || "{}") as Partial<PlaybackPreferences>;
      return {
        ...defaultPlayback,
        ...saved,
        elevenlabs: { ...defaultPlayback.elevenlabs, ...saved.elevenlabs },
      };
    } catch {
      return defaultPlayback;
    }
  });
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [voices, setVoices] = useState(defaultVoices);
  const [elevenLabsConfig, setElevenLabsConfig] = useState(defaultElevenLabsConfig);
  const [schedulerSettings, setSchedulerSettings] = useState(defaultSchedulerSettings);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem("rehearsal:theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const { speak, stop } = useSpeech();
  const audioSequenceRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem("rehearsal:theme", theme);
  }, [theme]);
  useEffect(() => {
    window.localStorage.setItem("rehearsal:playback", JSON.stringify(playback));
  }, [playback]);
  useEffect(() => {
    window.localStorage.setItem("rehearsal:language", language);
    setItems(fallbackItems[language]); setAttempts({}); setActiveItemId(fallbackItems[language][0].publicId); setRevealedItems([]);
    void loadItems(language);
  }, [language]);
  useEffect(() => {
    void fetch(apiPath("/api/config")).then(async (response) => {
      if (!response.ok) throw new Error("API unavailable");
      const data = await response.json() as {
        openaiConfigured: boolean;
        scheduler?: SchedulerSettings & { algorithm: string };
        tts?: {
          providers?: {
            openai?: { voices?: string[] };
            elevenlabs?: ElevenLabsConfig;
          };
        };
      };
      setApiOnline(true); setOpenaiConfigured(data.openaiConfigured);
      if (data.scheduler) setSchedulerSettings(data.scheduler);
      if (data.tts?.providers?.openai?.voices?.length) setVoices(data.tts.providers.openai.voices);
      if (data.tts?.providers?.elevenlabs) setElevenLabsConfig(data.tts.providers.elevenlabs);
    }).catch(() => setApiOnline(false));
  }, []);

  const saveSchedulerSettings = async (settings: SchedulerSettings) => {
    const response = await fetch(apiPath("/api/settings/scheduler"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!response.ok) throw new Error("Settings update failed");
    const data = await response.json() as { scheduler: SchedulerSettings };
    setSchedulerSettings(data.scheduler);
    setApiOnline(true);
  };

  const loadItems = async (nextLanguage: Language) => {
    try {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const [itemsResponse, progressResponse] = await Promise.all([
        fetch(apiPath(`/api/practice/due?language=${nextLanguage}&limit=50`)),
        fetch(apiPath(`/api/practice/progress?language=${nextLanguage}&since=${encodeURIComponent(startOfDay.toISOString())}`)),
      ]);
      if (!itemsResponse.ok || !progressResponse.ok) throw new Error("API unavailable");
      const data = await itemsResponse.json() as { items: LearningItem[] };
      const progress = await progressResponse.json() as DailyProgress & { completed: number };
      setItems(data.items);
      setActiveItemId(data.items[0]?.publicId || "");
      setDailyProgress({ recall: progress.recall ?? progress.completed, shadow: progress.shadow ?? 0, pattern: progress.pattern ?? 0 });
      setApiOnline(true);
    } catch { setApiOnline(false); }
  };
  const resetAttempts = () => setAttempts({});
  const setPreference = (itemId: string, preference: ItemPreference) => {
    const previous = items.find((candidate) => candidate.publicId === itemId)?.preference || "neutral";
    setItems((current) => current.map((candidate) => candidate.publicId === itemId
      ? { ...candidate, preference } : candidate));
    void fetch(apiPath(`/api/items/${encodeURIComponent(itemId)}/preference`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preference }),
    }).then((response) => {
      if (!response.ok) throw new Error("Preference update failed");
      setApiOnline(true);
    }).catch(() => {
      setApiOnline(false);
      setItems((current) => current.map((candidate) => candidate.publicId === itemId
        ? { ...candidate, preference: previous } : candidate));
    });
  };
  const updatePracticeItem = (updated: LearningItem) => {
    setItems((current) => current.map((candidate) => candidate.publicId === updated.publicId ? updated : candidate));
  };
  const deletePracticeItem = (itemId: string) => {
    const nextItems = items.filter((candidate) => candidate.publicId !== itemId);
    setItems(nextItems);
    setAttempts((current) => {
      const next = { ...current }; delete next[itemId]; return next;
    });
    setRevealedItems((current) => current.filter((publicId) => publicId !== itemId));
    if (activeItemId === itemId) setActiveItemId(nextItems[0]?.publicId || "");
  };
  const setAnswer = (itemId: string, answer: string) => {
    setAttempts((current) => ({ ...current, [itemId]: { answer } }));
  };
  const checkAnswer = (itemId: string) => {
    const practiceItem = items.find((candidate) => candidate.publicId === itemId);
    const answer = attempts[itemId]?.answer.trim();
    if (!practiceItem || !answer) return;
    const local = evaluateAttempt({
      id: practiceItem.publicId,
      language: practiceItem.language,
      cue: practiceItem.cue,
      target: practiceItem.target,
      acceptedAnswers: practiceItem.acceptedAnswers,
      note: practiceItem.note,
      source: practiceItem.source,
      status: practiceItem.status,
    }, answer);
    const evaluation: Evaluation = {
      score: local.accuracy,
      verdict: local.verdict,
      naturalAnswer: local.expected,
      correctedAnswer: local.expected,
      summaryRu: local.verdict === "exact" ? "Точно." : "Сравни свой вариант с естественной фразой.",
      mistakes: [],
      expectedTokens: local.expectedTokens,
      answerTokens: local.answerTokens,
    };
    setActiveItemId(itemId);
    setAttempts((current) => ({ ...current, [itemId]: { answer, evaluation } }));
  };
  const commitRecall = (itemId: string, rating: ReviewRating) => {
    const reviewedItem = items.find((candidate) => candidate.publicId === itemId);
    const attempt = attempts[itemId];
    if (!reviewedItem || !attempt?.evaluation) return;
    const nextItems = items.filter((candidate) => candidate.publicId !== itemId);
    setItems(nextItems);
    setActiveItemId(nextItems[0]?.publicId || "");
    setDailyProgress((progress) => ({ ...progress, recall: progress.recall + 1 }));
    void fetch(apiPath("/api/attempts/evaluate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: reviewedItem.publicId, answer: attempt.answer, mode: "recall", rating }),
    }).then((response) => {
      if (!response.ok) throw new Error("Review failed");
      setApiOnline(true);
      setAttempts((current) => {
        const next = { ...current }; delete next[itemId]; return next;
      });
      if (nextItems.length < 10) void loadItems(language);
    }).catch(() => {
      setApiOnline(false);
      setItems((current) => current.some((candidate) => candidate.publicId === itemId)
        ? current : [reviewedItem, ...current]);
      setActiveItemId(itemId);
      setDailyProgress((progress) => ({ ...progress, recall: Math.max(0, progress.recall - 1) }));
    });
  };
  const advanceShadow = (itemId: string) => {
    const itemIndex = items.findIndex((candidate) => candidate.publicId === itemId);
    const nextItems = moveReviewedItem(items, "good", itemIndex);
    setItems(nextItems); setActiveItemId(nextItems[0]?.publicId || itemId);
    setDailyProgress((progress) => ({ ...progress, shadow: progress.shadow + 1 }));
    void fetch(apiPath("/api/reviews"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, mode: "shadow", rating: "good" }),
    }).then((response) => { if (!response.ok) throw new Error("Shadow review failed"); setApiOnline(true); })
      .catch(() => { setApiOnline(false); setDailyProgress((progress) => ({ ...progress, shadow: Math.max(0, progress.shadow - 1) })); });
  };
  const playTarget = async (
    text: string,
    overrides: Partial<PlaybackPreferences> = {},
    strictProvider = false,
  ) => {
    stop();
    audioSequenceRef.current += 1;
    const sequence = audioSequenceRef.current;
    const nextPlayback = {
      ...playback,
      ...overrides,
      elevenlabs: { ...playback.elevenlabs, ...overrides.elevenlabs },
    };
    const playAudioResponse = async (response: Response) => {
      const url = URL.createObjectURL(await response.blob());
      for (let repetition = 0; repetition < nextPlayback.repetitions; repetition += 1) {
        if (sequence !== audioSequenceRef.current) break;
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.addEventListener("ended", () => resolve(), { once: true });
          audio.addEventListener("error", () => resolve(), { once: true });
          void audio.play().catch(() => resolve());
        });
        if (repetition < nextPlayback.repetitions - 1 && sequence === audioSequenceRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, nextPlayback.pauseMs));
        }
      }
      URL.revokeObjectURL(url);
    };
    if (openaiConfigured || elevenLabsConfig.configured) {
      try {
        const provider = !strictProvider && language === "lv" && nextPlayback.provider === "elevenlabs"
          ? "openai" : nextPlayback.provider;
        const response = await fetch(apiPath("/api/audio/speech"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            language: strictProvider && nextPlayback.provider === "elevenlabs" ? "en" : language,
            provider,
            speed: nextPlayback.speed,
            voice: nextPlayback.voice,
            voiceId: elevenLabsConfig.voice.id,
            ...nextPlayback.elevenlabs,
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(error?.message || "TTS unavailable");
        }
        await playAudioResponse(response);
        return;
      } catch (error) {
        if (strictProvider) throw error;
        if (nextPlayback.provider === "elevenlabs") {
          try {
            const response = await fetch(apiPath("/api/audio/speech"), {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, language, provider: "openai", speed: nextPlayback.speed, voice: nextPlayback.voice }),
            });
            if (response.ok) {
              await playAudioResponse(response);
              return;
            }
          } catch { /* Browser speech is the final fallback. */ }
        }
      }
    }
    await speak(text, {
      locale: languageCopy[language].locale,
      rate: nextPlayback.speed,
      repetitions: nextPlayback.repetitions,
      pauseMs: nextPlayback.pauseMs,
    });
  };

  return <div className={`simple-app simple-app--${theme}`}>
    <header className="simple-header">
      <button className="simple-brand" onClick={() => setRoute("practice")} type="button"><span>R</span><strong>Rehearsal</strong></button>
      <nav className="simple-nav" aria-label="Main navigation">
        <button className={route === "practice" ? "is-active" : ""} onClick={() => setRoute("practice")} type="button">Practice</button>
        <button className={route === "tutor" ? "is-active" : ""} onClick={() => setRoute("tutor")} type="button">Tutor</button>
        <button className={route === "library" ? "is-active" : ""} onClick={() => setRoute("library")} type="button">Library</button>
      </nav>
      <div className="simple-header-actions">
        <label className="simple-language"><span>{languageCopy[language].short}</span>
          <select onChange={(event) => setLanguage(event.target.value as Language)} value={language}>
            <option value="en">English</option><option value="lv">Latviešu</option>
          </select><ChevronDown size={15} />
        </label>
        <span className={`simple-api-state ${apiOnline ? "is-online" : ""}`} title={apiOnline ? "Backend online" : "Backend unavailable"} />
        <button aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          aria-pressed={theme === "dark"} className="simple-icon-button simple-theme-button"
          onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Light theme" : "Dark theme"} type="button">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button aria-label="Settings" className="simple-icon-button simple-global-settings-button" onClick={() => setGlobalSettingsOpen(true)} title="Settings" type="button"><Settings2 size={18} /></button>
      </div>
    </header>
    {globalSettingsOpen ? <GlobalSettings
      onClose={() => setGlobalSettingsOpen(false)}
      onPlayback={setPlayback}
      onPreview={() => playTarget("This is how your tutor will sound.", { repetitions: 1 }, true)}
      onSaveScheduler={saveSchedulerSettings}
      elevenLabs={elevenLabsConfig}
      playback={playback}
      scheduler={schedulerSettings}
      voices={voices}
    /> : null}
    {route === "practice" && <PracticePage activeItemId={activeItemId} attempts={attempts}
      items={items} language={language} mode={mode} dailyProgress={dailyProgress}
      onActivate={setActiveItemId} onAnswer={setAnswer} onCheck={checkAnswer}
      onMode={(next) => { setMode(next); resetAttempts(); }} onRecallReview={commitRecall}
      onPreference={setPreference}
      onItemDeleted={deletePracticeItem} onItemUpdated={updatePracticeItem}
      onPlayback={setPlayback} onPlay={(text) => void playTarget(text)} onShadowNext={advanceShadow}
      onReveal={(publicId) => setRevealedItems((current) => current.includes(publicId)
        ? current.filter((id) => id !== publicId) : [...current, publicId])}
      playback={playback} revealedItems={revealedItems} />}
    {route === "tutor" && <TutorPage language={language} />}
    {route === "library" && <LibraryPage language={language} onPlay={(text) => void playTarget(text)} />}
  </div>;
}

function GlobalSettings(props: {
  elevenLabs: ElevenLabsConfig;
  onClose: () => void;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPreview: () => Promise<void>;
  onSaveScheduler: (settings: SchedulerSettings) => Promise<void>;
  playback: PlaybackPreferences;
  scheduler: SchedulerSettings;
  voices: string[];
}) {
  const [draft, setDraft] = useState(props.scheduler);
  const [learningSteps, setLearningSteps] = useState(props.scheduler.learningSteps.join(", "));
  const [relearningSteps, setRelearningSteps] = useState(props.scheduler.relearningSteps.join(", "));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [previewState, setPreviewState] = useState<"idle" | "playing" | "error">("idle");
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props.onClose]);

  const parseSteps = (value: string) => value.split(/[\s,]+/).map((step) => step.trim()).filter(Boolean);
  const stepPattern = /^\d+(?:\.\d+)?[mhd]$/;
  const nextLearningSteps = parseSteps(learningSteps);
  const nextRelearningSteps = parseSteps(relearningSteps);
  const validSteps = [nextLearningSteps, nextRelearningSteps]
    .every((steps) => steps.length > 0 && steps.length <= 4 && steps.every((step) => stepPattern.test(step)));

  const save = async () => {
    if (!validSteps || saveState === "saving") return;
    setSaveState("saving");
    try {
      await props.onSaveScheduler({
        ...draft,
        learningSteps: nextLearningSteps,
        relearningSteps: nextRelearningSteps,
      });
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const updatePreset = (
    preference: ItemPreference,
    field: "requestRetention" | "maximumInterval",
    value: number,
  ) => {
    setSaveState("idle");
    setDraft((current) => ({
      ...current,
      presets: {
        ...current.presets,
        [preference]: { ...current.presets[preference], [field]: value },
      },
    }));
  };

  const updateElevenLabs = <Key extends keyof ElevenLabsPreferences>(
    key: Key,
    value: ElevenLabsPreferences[Key],
  ) => props.onPlayback({
    ...props.playback,
    elevenlabs: { ...props.playback.elevenlabs, [key]: value },
  });

  const preview = async () => {
    setPreviewState("playing");
    setPreviewError("");
    try {
      await props.onPreview();
      setPreviewState("idle");
    } catch (error) {
      setPreviewState("error");
      setPreviewError(error instanceof Error ? error.message : "Voice preview failed");
    }
  };

  return <div className="simple-settings-overlay" onMouseDown={(event) => {
    if (event.target === event.currentTarget) props.onClose();
  }}>
    <section aria-labelledby="global-settings-title" aria-modal="true" className="simple-settings-panel" role="dialog">
      <header className="simple-settings-header">
        <div><h2 id="global-settings-title">Settings</h2><span>Audio and review timing</span></div>
        <button aria-label="Close settings" onClick={props.onClose} type="button"><X size={18} /></button>
      </header>

      <div className="simple-settings-scroll">
        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Voice</h3><span>AI-generated</span></div>
          <div className="simple-provider-switch" role="group" aria-label="Voice provider">
            {(["openai", "elevenlabs"] as TtsProvider[]).map((provider) => <button
              className={props.playback.provider === provider ? "is-active" : ""}
              key={provider}
              onClick={() => props.onPlayback({
                ...props.playback,
                provider,
                speed: provider === "elevenlabs" ? props.elevenLabs.defaults.speed : props.playback.speed,
              })}
              type="button"
            >{provider === "openai" ? "OpenAI" : "ElevenLabs"}</button>)}
          </div>

          {props.playback.provider === "openai" ? <div className="simple-voice-grid">
            {props.voices.map((voice) => <button className={props.playback.voice === voice ? "is-active" : ""}
              key={voice} onClick={() => props.onPlayback({ ...props.playback, voice })} type="button">
              <span>{capitalize(voice)}</span>{["marin", "cedar"].includes(voice) ? <small>recommended</small> : null}
            </button>)}
          </div> : <>
            <div className="simple-elevenlabs-voice">
              <div><strong>{props.elevenLabs.voice.name}</strong><span>Tender, kind and steady · American English</span></div>
              <a href={`https://elevenlabs.io/app/voice-library?voiceId=${props.elevenLabs.voice.id}`} rel="noreferrer" target="_blank">Voice page</a>
            </div>
            <div className="simple-elevenlabs-status">
              <i className={props.elevenLabs.configured ? "is-ready" : ""} />
              <span>{props.elevenLabs.configured ? "API connected" : "API key missing"}</span>
              <small>Paid plan required for this library voice</small>
            </div>
            <div className="simple-model-choice">
              <span>Model</span><div>
                <button className={props.playback.elevenlabs.modelId === "eleven_multilingual_v2" ? "is-active" : ""}
                  onClick={() => updateElevenLabs("modelId", "eleven_multilingual_v2")} type="button">Quality</button>
                <button className={props.playback.elevenlabs.modelId === "eleven_flash_v2_5" ? "is-active" : ""}
                  onClick={() => updateElevenLabs("modelId", "eleven_flash_v2_5")} type="button">Fast</button>
              </div>
            </div>
            <div className="simple-voice-tuning">
              {([
                ["stability", "Stability"],
                ["similarityBoost", "Similarity"],
                ["style", "Style"],
              ] as const).map(([key, label]) => <label key={key}>
                <span>{label}<strong>{props.playback.elevenlabs[key].toFixed(2)}</strong></span>
                <input max="1" min="0" onChange={(event) => updateElevenLabs(key, Number(event.target.value))}
                  step="0.01" type="range" value={props.playback.elevenlabs[key]} />
              </label>)}
              <div className="simple-speaker-boost"><span>Speaker boost</span><button aria-pressed={props.playback.elevenlabs.speakerBoost}
                className={props.playback.elevenlabs.speakerBoost ? "is-active" : ""}
                onClick={() => updateElevenLabs("speakerBoost", !props.playback.elevenlabs.speakerBoost)} type="button"><i /></button></div>
            </div>
          </>}
          <button className="simple-voice-preview" disabled={previewState === "playing"}
            onClick={() => void preview()} type="button">
            {previewState === "playing" ? <LoaderCircle className="simple-spin" size={13} /> : <Play fill="currentColor" size={13} />}
            Preview {props.playback.provider === "openai" ? capitalize(props.playback.voice) : props.elevenLabs.voice.name}
          </button>
          {previewState === "error" ? <p className="simple-voice-error">{previewError}</p> : null}
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>Playback</h3><span>This device</span></div>
          <div className="simple-global-playback">
            <div className="simple-global-setting"><label>Repeats</label><div>
              {[1, 2, 3, 5].map((value) => <button className={props.playback.repetitions === value ? "is-active" : ""}
                key={value} onClick={() => props.onPlayback({ ...props.playback, repetitions: value })} type="button">{value}×</button>)}
            </div></div>
            <label className="simple-global-setting simple-global-speed"><span>Speed <strong>{props.playback.speed.toFixed(2)}×</strong></span>
              <input max="1.5" min="0.5" onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })}
                step="0.05" type="range" value={props.playback.speed} /></label>
            <div className="simple-global-setting"><label>Pause</label><div>
              {[500, 1500, 3000].map((value) => <button className={props.playback.pauseMs === value ? "is-active" : ""}
                key={value} onClick={() => props.onPlayback({ ...props.playback, pauseMs: value })} type="button">{value / 1000}s</button>)}
            </div></div>
          </div>
        </section>

        <section className="simple-settings-section">
          <div className="simple-settings-section-title"><h3>FSRS-6</h3><span>Recall scheduler</span></div>
          <label className="simple-new-items-setting"><span>New cards per day</span><input max="30" min="0" onChange={(event) => {
            setDraft((current) => ({ ...current, newItemsPerDay: Number(event.target.value) })); setSaveState("idle");
          }} type="number" value={draft.newItemsPerDay} /></label>
          <div className="simple-fsrs-table">
            <div className="simple-fsrs-head"><span>Priority</span><span>Retention</span><span>Max interval</span></div>
            {(["like", "neutral", "dislike"] as ItemPreference[]).map((preference) => <div className="simple-fsrs-row" key={preference}>
              <strong>{capitalize(preference)}</strong>
              <label><input max="97" min="80" onChange={(event) => updatePreset(preference, "requestRetention", Number(event.target.value) / 100)}
                step="1" type="number" value={Math.round(draft.presets[preference].requestRetention * 100)} /><span>%</span></label>
              <label><input max="3650" min="7" onChange={(event) => updatePreset(preference, "maximumInterval", Number(event.target.value))}
                step="1" type="number" value={draft.presets[preference].maximumInterval} /><span>days</span></label>
            </div>)}
          </div>
          <div className="simple-fsrs-details">
            <label><span>Learning steps</span><input aria-invalid={!nextLearningSteps.length || nextLearningSteps.some((step) => !stepPattern.test(step))}
              onChange={(event) => { setLearningSteps(event.target.value); setSaveState("idle"); }} value={learningSteps} /></label>
            <label><span>Relearning steps</span><input aria-invalid={!nextRelearningSteps.length || nextRelearningSteps.some((step) => !stepPattern.test(step))}
              onChange={(event) => { setRelearningSteps(event.target.value); setSaveState("idle"); }} value={relearningSteps} /></label>
            <div className="simple-fsrs-toggle"><span>Interval fuzz</span><button aria-pressed={draft.fuzz} className={draft.fuzz ? "is-active" : ""}
              onClick={() => { setDraft((current) => ({ ...current, fuzz: !current.fuzz })); setSaveState("idle"); }} type="button"><i /></button></div>
          </div>
        </section>
      </div>

      <footer className="simple-settings-footer">
        <span className={`is-${saveState}`}>{saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn’t save" : !validSteps ? "Use steps like 1m, 10m" : ""}</span>
        <button className="simple-settings-save" disabled={!validSteps || saveState === "saving"} onClick={() => void save()} type="button">
          {saveState === "saving" ? "Saving…" : "Save FSRS"}
        </button>
      </footer>
    </section>
  </div>;
}

function PracticePage(props: {
  activeItemId: string;
  attempts: Record<string, AttemptDraft>;
  items: LearningItem[];
  language: Language;
  mode: Mode;
  dailyProgress: DailyProgress;
  onActivate: (itemId: string) => void;
  onAnswer: (itemId: string, value: string) => void;
  onCheck: (itemId: string) => void;
  onMode: (mode: Mode) => void;
  onItemDeleted: (itemId: string) => void;
  onItemUpdated: (item: LearningItem) => void;
  onPlayback: (playback: PlaybackPreferences) => void;
  onPreference: (itemId: string, preference: ItemPreference) => void;
  onPlay: (text: string) => void;
  onRecallReview: (itemId: string, rating: ReviewRating) => void;
  onReveal: (publicId: string) => void;
  onShadowNext: (itemId: string) => void;
  playback: PlaybackPreferences;
  revealedItems: string[];
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [topicFilter, setTopicFilter] = useState("all");
  const [frequencyFilter, setFrequencyFilter] = useState("all");
  const [selectedRatings, setSelectedRatings] = useState<Record<string, ReviewRating>>({});
  const [editingItem, setEditingItem] = useState<LearningItem | null>(null);
  const targetCode = languageCopy[props.language].short;
  const targetLabel = languageCopy[props.language].label;
  const goal = 100;
  const progress = Math.min(100, (props.dailyProgress.recall / goal) * 100);
  const topics = useMemo(() => [...new Set(props.items.flatMap((item) => item.tags.slice(0, 1)))].filter(Boolean).sort(), [props.items]);
  const visibleItems = useMemo(() => props.items.filter((item) =>
    (topicFilter === "all" || item.tags.includes(topicFilter)) &&
    (frequencyFilter === "all" || (item.frequencyBand || "common") === frequencyFilter)),
  [frequencyFilter, props.items, topicFilter]);

  const activeHasEvaluation = Boolean(props.attempts[props.activeItemId]?.evaluation);
  useEffect(() => {
    if (props.mode !== "recall") return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-practice-input="${props.activeItemId}"]`)?.focus();
    });
  }, [activeHasEvaluation, props.activeItemId, props.items, props.mode]);

  return <main className="simple-main simple-main--practice">
    <header className="simple-practice-toolbar">
      <div className="simple-practice-title">
        <h1>Practice</h1>
        <div aria-label={`${props.dailyProgress.recall} of ${goal} recall attempts today`} className="simple-daily-progress">
          <span><strong>{props.dailyProgress.recall}</strong> / {goal} recall · {props.dailyProgress.shadow} shadow</span>
          <i><b style={{ width: `${progress}%` }} /></i>
        </div>
      </div>
      <div className="simple-feed-tools">
        <button
          aria-label={`Switch to ${props.mode === "recall" ? `${targetCode} to RU shadowing` : `RU to ${targetCode} recall`}`}
          className="simple-direction-toggle"
          onClick={() => props.onMode(props.mode === "recall" ? "shadow" : "recall")}
          type="button"
        >
          <span>{props.mode === "recall" ? "RU" : targetCode}</span>
          <span className="simple-direction-track"><ArrowRight size={13} /></span>
          <span>{props.mode === "recall" ? targetCode : "RU"}</span>
        </button>
        <div className="simple-filter-wrap"><button aria-expanded={filtersOpen} className="simple-filter-button" onClick={() => setFiltersOpen((open) => !open)} type="button">
          {topicFilter === "all" ? "All topics" : topicFilter} <ChevronDown size={14} /></button>
          {filtersOpen ? <div className="simple-filter-popover"><label>Topic<select onChange={(event) => setTopicFilter(event.target.value)} value={topicFilter}>
            <option value="all">All topics</option>{topics.map((topic) => <option key={topic} value={topic}>{topic}</option>)}</select></label>
            <label>Frequency<select onChange={(event) => setFrequencyFilter(event.target.value)} value={frequencyFilter}>
              <option value="all">Any frequency</option><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
            </select></label><button onClick={() => { setTopicFilter("all"); setFrequencyFilter("all"); setFiltersOpen(false); }} type="button">Reset</button></div> : null}</div>
        <button aria-label="Practice settings" className="simple-icon-button" onClick={() => setSettingsOpen((open) => !open)} type="button">
          <Settings2 size={17} />
        </button>
      </div>
    </header>

    {settingsOpen ? <section aria-label="Playback settings" className="simple-inline-settings">
      <header><div><strong>Playback</strong><small>Shadowing rhythm for this device.</small></div>
        <button onClick={() => setSettingsOpen(false)} type="button">Done</button></header>
      <div className="simple-playback-options">
        <div className="simple-playback-setting"><span>Repeats</span><div>
          {[1, 2, 3, 5].map((value) => <button className={props.playback.repetitions === value ? "is-active" : ""}
            key={value} onClick={() => props.onPlayback({ ...props.playback, repetitions: value })} type="button">{value}×</button>)}
        </div></div>
        <label className="simple-playback-setting simple-speed-setting"><span>Speed <strong>{props.playback.speed.toFixed(2)}×</strong></span>
          <input aria-label="Playback speed" max="1.5" min="0.5" onChange={(event) => props.onPlayback({ ...props.playback, speed: Number(event.target.value) })}
            step="0.05" type="range" value={props.playback.speed} /></label>
        <div className="simple-playback-setting"><span>Pause</span><div>
          {[500, 1500, 3000].map((value) => <button className={props.playback.pauseMs === value ? "is-active" : ""}
            key={value} onClick={() => props.onPlayback({ ...props.playback, pauseMs: value })} type="button">{value / 1000}s</button>)}
        </div></div>
      </div>
    </section> : null}

    <section className="simple-island-feed" aria-label="Practice feed">
      {!visibleItems.length ? <p className="simple-feed-empty">Nothing matches these filters.</p> : null}
      {visibleItems.map((feedItem) => {
        const isCurrent = feedItem.publicId === props.activeItemId;
        const isRevealed = props.revealedItems.includes(feedItem.publicId);
        const attempt = props.attempts[feedItem.publicId] || { answer: "" };
        const grade = selectedRatings[feedItem.publicId] || "good";
        const topic = feedItem.tags[0] || feedItem.source || "Personal";

        return <article className={`simple-island-card${isCurrent ? " is-current" : ""}`} key={feedItem.publicId}>
          <div className="simple-island-prompt">
            <p>{props.mode === "recall" ? feedItem.cue : feedItem.target}</p>
            <button aria-label="Play phrase" className="simple-card-play" onClick={() => props.onPlay(feedItem.target)} type="button">
              <Play fill="currentColor" size={15} />
            </button>
          </div>

          {props.mode === "recall" ? <>
            <div className="simple-card-input-row">
              <input
                data-practice-input={feedItem.publicId}
                onChange={(event) => { if (!attempt.evaluation) props.onAnswer(feedItem.publicId, event.target.value); }}
                onFocus={() => props.onActivate(feedItem.publicId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (attempt.evaluation) props.onRecallReview(feedItem.publicId, grade);
                    else props.onCheck(feedItem.publicId);
                    return;
                  }
                  if (attempt.evaluation && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
                    setSelectedRatings((current) => ({
                      ...current,
                      [feedItem.publicId]: moveReviewRating(grade, direction),
                    }));
                  }
                }}
                placeholder={`Type in ${targetLabel}`}
                readOnly={Boolean(attempt.evaluation)}
                value={attempt.answer}
              />
              {!attempt.evaluation ? <button aria-label="Check phrase" className="simple-primary simple-card-check" disabled={!attempt.answer.trim()} onClick={() => props.onCheck(feedItem.publicId)} title="Check · Enter" type="button">
                <Check size={15} />
              </button> : null}
            </div>

            {attempt.evaluation ? <div className={`simple-inline-result simple-inline-result--${attempt.evaluation.verdict}`}>
              <div className="simple-inline-answer">
                <span>{attempt.evaluation.verdict === "exact" ? "Correct" : "Compare"}</span>
                {attempt.evaluation.verdict === "exact" ? <p>{attempt.evaluation.correctedAnswer}</p> : <div className="simple-word-diff">
                  <p aria-label="Your answer">{attempt.evaluation.answerTokens?.map((token, tokenIndex) =>
                    token.status === "extra" ? <del key={`${token.value}-${tokenIndex}`}>{token.value}</del> : <span key={`${token.value}-${tokenIndex}`}>{token.value}</span>)}</p>
                  <p aria-label="Natural version">{attempt.evaluation.expectedTokens?.map((token, tokenIndex) =>
                    token.status === "missing" ? <strong key={`${token.value}-${tokenIndex}`}>{token.value}</strong> : <span key={`${token.value}-${tokenIndex}`}>{token.value}</span>)}</p>
                </div>}
              </div>
              {attempt.evaluation.mistakes.map((mistake) => <p className="simple-inline-mistake" key={`${mistake.original}-${mistake.correction}`}>
                <del>{mistake.original}</del><ArrowRight size={13} /><strong>{mistake.correction}</strong>
                {mistake.explanationRu ? <small>{mistake.explanationRu}</small> : null}
              </p>)}
              <div className="simple-memory-grades" aria-label="Memory grade">
                {reviewRatings.map((rating) => <button
                  aria-pressed={rating === grade}
                  className={rating === grade ? "is-default" : ""}
                  key={rating}
                  onClick={() => props.onRecallReview(feedItem.publicId, rating)}
                  title={gradeTitle[rating]}
                  type="button"
                ><span>{capitalize(rating)}</span><small>{formatInterval(feedItem.schedule?.options[rating].intervalSeconds)}</small></button>)}
              </div>
            </div> : null}
          </> : null}

          {isCurrent && props.mode === "shadow" ? <div className="simple-shadow-next">
            <button aria-label="Next phrase" onClick={() => props.onShadowNext(feedItem.publicId)} title="Next phrase" type="button">
              <ChevronRight size={17} />
            </button>
          </div> : null}

          <footer className="simple-island-footer">
            <span>
              {props.mode === "shadow" || !attempt.evaluation ? <button className="simple-reveal" onClick={() => props.onReveal(feedItem.publicId)} type="button">
                {isRevealed ? "Hide" : props.mode === "recall" ? `Show in ${targetCode}` : "Show in RU"}
              </button> : null}
              {isRevealed ? <span className="simple-revealed-copy">{props.mode === "recall" ? feedItem.target : feedItem.cue}</span> : null}
            </span>
            <div className="simple-card-meta">
              <div aria-label="Card preference" className="simple-preference-actions">
                <button aria-label="Like this card" aria-pressed={feedItem.preference === "like"}
                  className={feedItem.preference === "like" ? "is-active" : ""}
                  onClick={() => props.onPreference(feedItem.publicId, feedItem.preference === "like" ? "neutral" : "like")}
                  title="Like" type="button"><ThumbsUp size={14} /></button>
                <button aria-label="Dislike this card" aria-pressed={feedItem.preference === "dislike"}
                  className={feedItem.preference === "dislike" ? "is-active" : ""}
                  onClick={() => props.onPreference(feedItem.publicId, feedItem.preference === "dislike" ? "neutral" : "dislike")}
                  title="Dislike" type="button"><ThumbsDown size={14} /></button>
              </div>
              <span><i />{topic}<small>{feedItem.schedule?.state || feedItem.status}</small></span>
              <button aria-label={`Edit ${feedItem.target}`} className="simple-card-edit" onClick={() => setEditingItem(feedItem)}
                title="Edit card" type="button"><Pencil size={13} /><span>Edit</span></button>
            </div>
          </footer>
        </article>;
      })}
    </section>
    {editingItem ? <PracticeItemEditor item={editingItem} language={props.language}
      onClose={() => setEditingItem(null)} onDeleted={(itemId) => { setEditingItem(null); props.onItemDeleted(itemId); }}
      onUpdated={(item) => { setEditingItem(null); props.onItemUpdated(item); }} /> : null}
  </main>;
}

function PracticeItemEditor(props: {
  item: LearningItem;
  language: Language;
  onClose: () => void;
  onDeleted: (itemId: string) => void;
  onUpdated: (item: LearningItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cue, setCue] = useState(props.item.cue);
  const [target, setTarget] = useState(props.item.target);
  const [note, setNote] = useState(props.item.note);
  const [category, setCategory] = useState(props.item.tags[0] || "");
  const [frequencyBand, setFrequencyBand] = useState(props.item.frequencyBand || "common");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  const save = async () => {
    if (!cue.trim() || !target.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const secondaryTags = props.item.tags.slice(1);
      const response = await fetch(apiPath(`/api/items/${encodeURIComponent(props.item.publicId)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cue: cue.trim(),
          target: target.trim(),
          note: note.trim(),
          tags: category.trim() ? [category.trim(), ...secondaryTags] : secondaryTags,
          frequencyBand,
        }),
      });
      if (!response.ok) throw new Error("Could not save this card");
      const data = await response.json() as { item: LearningItem };
      props.onUpdated(data.item);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save this card");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this card from your library and practice history?")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(apiPath(`/api/items/${encodeURIComponent(props.item.publicId)}`), { method: "DELETE" });
      if (!response.ok) throw new Error("Could not delete this card");
      props.onDeleted(props.item.publicId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not delete this card");
      setSaving(false);
    }
  };

  return <dialog aria-labelledby="practice-item-editor-title" className="simple-card-dialog" onCancel={(event) => {
    event.preventDefault(); props.onClose();
  }} onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }} ref={dialogRef}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header><div><h2 id="practice-item-editor-title">Edit card</h2><span>{props.item.source || "Personal library"}</span></div>
        <button aria-label="Close editor" onClick={props.onClose} type="button"><X size={17} /></button></header>
      <div className="simple-card-dialog-fields">
        <label><span>Russian cue</span><textarea autoFocus onChange={(event) => setCue(event.target.value)} rows={3} value={cue} /></label>
        <label><span>{languageCopy[props.language].label}</span><textarea onChange={(event) => setTarget(event.target.value)} rows={3} value={target} /></label>
        <label><span>Note</span><textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></label>
        <div className="simple-card-dialog-row">
          <label><span>Category</span><input onChange={(event) => setCategory(event.target.value)} value={category} /></label>
          <label><span>Frequency</span><select onChange={(event) => setFrequencyBand(event.target.value as NonNullable<LearningItem["frequencyBand"]>)} value={frequencyBand}>
            <option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option>
          </select></label>
        </div>
        {error ? <p className="simple-card-dialog-error" role="alert">{error}</p> : null}
      </div>
      <footer><button className="simple-card-dialog-delete" disabled={saving} onClick={() => void remove()} type="button"><Trash2 size={14} />Delete</button>
        <div><button disabled={saving} onClick={props.onClose} type="button">Cancel</button>
          <button className="simple-primary" disabled={saving || !cue.trim() || !target.trim()} type="submit">{saving ? "Saving…" : "Save"}</button></div></footer>
    </form>
  </dialog>;
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const gradeTitle: Record<ReviewRating, string> = {
  again: "Forgot",
  hard: "Recalled with hesitation",
  good: "Recalled",
  easy: "Immediate recall",
};

const formatInterval = (seconds?: number) => {
  if (seconds === undefined) return "";
  if (seconds < 60) return "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

const renderInlineMarkdown = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
  part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part);

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 className="simple-message-heading" key={`heading-${index}`}>{renderInlineMarkdown(heading[1])}</h3>);
      index += 1; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, "")); index += 1;
      }
      nodes.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index].trim()) && !/^[-*]\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim()); index += 1;
    }
    nodes.push(<p key={`paragraph-${index}`}>{paragraph.map((part, partIndex) => <span key={partIndex}>{renderInlineMarkdown(part)}{partIndex < paragraph.length - 1 ? <br /> : null}</span>)}</p>);
  }
  return <div className="simple-message-copy">{nodes}</div>;
}

const looksLikeVocabList = (content: string) => {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 5 && lines.reduce((sum, line) => sum + line.split(/\s+/).length, 0) / lines.length <= 8;
};

const parseThreadDate = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

const formatThreadDate = (value: string) => {
  const date = parseThreadDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
};

function TutorPage({ language }: { language: Language }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [draft, setDraft] = useState(""); const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false); const [sessionsOpen, setSessionsOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false); const [reviewBatch, setReviewBatch] = useState<ReviewBatch | null>(null);
  const [threadId, setThreadId] = useState<string>(); const messagesRef = useRef<HTMLDivElement>(null);
  const storageKey = `rehearsal:tutor-thread:${language}`;

  const refreshThreads = async () => {
    const response = await fetch(apiPath(`/api/chat/threads?language=${language}&limit=50`));
    if (!response.ok) throw new Error("Could not load sessions");
    const data = await response.json() as { threads: ChatThread[] };
    setThreads(data.threads || []);
    return data.threads || [];
  };

  const openThread = async (publicId: string) => {
    if (loadingThread || publicId === threadId) { setSessionsOpen(false); return; }
    setLoadingThread(true); setReviewBatch(null);
    try {
      const response = await fetch(apiPath(`/api/chat/${publicId}/messages`));
      if (!response.ok) throw new Error("Could not load session");
      const data = await response.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> };
      setMessages(data.messages.map((message) => ({ ...message, id: crypto.randomUUID() })));
      setThreadId(publicId); window.localStorage.setItem(storageKey, publicId); setSessionsOpen(false);
    } finally { setLoadingThread(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setThreadId(undefined); setReviewBatch(null); setMessages([]); setThreads([]);
    void (async () => {
      try {
        const response = await fetch(apiPath(`/api/chat/threads?language=${language}&limit=50`));
        if (!response.ok) return;
        const data = await response.json() as { threads: ChatThread[] };
        if (cancelled) return;
        const nextThreads = data.threads || []; setThreads(nextThreads);
        const stored = window.localStorage.getItem(storageKey);
        const selected = nextThreads.find((thread) => thread.publicId === stored) || nextThreads[0];
        if (!selected) return;
        const history = await fetch(apiPath(`/api/chat/${selected.publicId}/messages`));
        if (!history.ok || cancelled) return;
        const loaded = await history.json() as { messages: Array<{ role: "user" | "assistant"; content: string }> };
        if (cancelled) return;
        setThreadId(selected.publicId); window.localStorage.setItem(storageKey, selected.publicId);
        setMessages(loaded.messages.map((message) => ({ ...message, id: crypto.randomUUID() })));
      } catch { /* A blank Tutor remains usable when history is unavailable. */ }
    })();
    return () => { cancelled = true; };
  }, [language]);

  useEffect(() => {
    const messageList = messagesRef.current;
    if (messageList) messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages, reviewBatch]);

  const newChat = () => {
    setThreadId(undefined); setMessages([]); setReviewBatch(null); setDraft(""); setSessionsOpen(false);
    window.localStorage.removeItem(storageKey);
  };

  const prepareVocab = async (content: string) => {
    const response = await fetch(apiPath("/api/review-batches/vocab"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, title: "Vocabulary from Tutor", text: content, threadId }),
    });
    if (!response.ok) throw new Error("Vocab preparation failed");
    const data = await response.json() as { batch: ReviewBatch; threadId: string; content: string };
    setReviewBatch(data.batch); setThreadId(data.threadId); window.localStorage.setItem(storageKey, data.threadId);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.content }]);
  };

  const send = async () => {
    const content = draft.trim(); if (!content || sending) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content }]); setDraft(""); setSending(true);
    try {
      if (looksLikeVocabList(content)) await prepareVocab(content);
      else {
        const response = await fetch(apiPath("/api/chat"), { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, message: content, threadId }) });
        if (!response.ok) throw new Error("Chat unavailable");
        const data = await response.json() as { threadId: string; content: string }; setThreadId(data.threadId);
        window.localStorage.setItem(storageKey, data.threadId);
        setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: data.content }]);
      }
      await refreshThreads();
    } catch { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "Tutor is unavailable right now. Nothing was added to Library." }]); }
    finally { setSending(false); }
  };

  const finishReview = async () => {
    if (!threadId || reviewing) return; setReviewing(true);
    try {
      const response = await fetch(apiPath(`/api/chat/${threadId}/review`), { method: "POST" });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { batch: ReviewBatch }; setReviewBatch(data.batch);
    } catch { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: "Review could not be prepared. Nothing was added to Library." }]); }
    finally { setReviewing(false); }
  };

  const today = new Date().toDateString();
  const currentThread = threads.find((thread) => thread.publicId === threadId);
  const threadGroups = [
    { label: "Today", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() === today) },
    { label: "Earlier", items: threads.filter((thread) => parseThreadDate(thread.updatedAt).toDateString() !== today) },
  ].filter((group) => group.items.length);

  return <main className="simple-main simple-main--chat">
    <header className="simple-page-heading simple-tutor-heading"><h1>Tutor</h1>
      <div className="simple-tutor-mobile-actions">
        <button onClick={() => setSessionsOpen(true)} type="button"><PanelLeft size={16} />Sessions</button>
        <button aria-label="New chat" onClick={newChat} title="New chat" type="button"><Plus size={17} /></button>
      </div></header>
    <section className="simple-chat">
      {sessionsOpen ? <button aria-label="Close sessions" className="simple-session-backdrop" onClick={() => setSessionsOpen(false)} type="button" /> : null}
      <aside className={`simple-session-rail ${sessionsOpen ? "is-open" : ""}`}>
        <div className="simple-session-rail-heading"><strong>Sessions</strong>
          <button aria-label="Close sessions" onClick={() => setSessionsOpen(false)} type="button"><X size={16} /></button></div>
        <button className="simple-new-chat" onClick={newChat} type="button"><Plus size={16} />New chat</button>
        <nav aria-label="Tutor sessions">{threadGroups.map((group) => <section className="simple-session-group" key={group.label}>
          <span>{group.label}</span>
          {group.items.map((thread) => <button className={thread.publicId === threadId ? "is-active" : ""}
            disabled={loadingThread} key={thread.publicId} onClick={() => void openThread(thread.publicId)} type="button">
            <strong>{thread.title}</strong><small>{formatThreadDate(thread.updatedAt)}</small>
          </button>)}
        </section>)}</nav>
      </aside>
      <div className="simple-chat-pane">
        <div className="simple-chat-toolbar"><strong>{currentThread?.title || "New chat"}</strong>
          {threadId ? <button className="simple-finish-review" disabled={reviewing || sending} onClick={() => void finishReview()} type="button">
            {reviewing ? <LoaderCircle className="simple-spin" size={15} /> : <Check size={15} />}Finish & review</button> : null}</div>
        <div className="simple-chat-messages" ref={messagesRef}>
          {messages.map((message) => <article className={`simple-message simple-message--${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "You" : "Tutor"}</span><MarkdownMessage content={message.content} /></article>)}
          {reviewBatch ? <ReviewBatchPanel batch={reviewBatch} onBatch={setReviewBatch} /> : null}
          {sending && <div className="simple-chat-loading"><LoaderCircle className="simple-spin" size={17} />Tutor is thinking…</div>}
        </div>
        <div className="simple-composer"><label className="simple-composer-upload" title="Upload a text file"><Upload size={17} /><input accept=".txt,text/plain" onChange={async (event) => {
          const file = event.target.files?.[0]; if (file) setDraft(await file.text()); event.target.value = "";
        }} type="file" /></label><textarea onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
          placeholder="Message your tutor…" rows={2} value={draft} />
          <button aria-label="Send" disabled={!draft.trim() || sending} onClick={() => void send()} type="button"><Send size={18} /></button></div>
      </div>
    </section>
  </main>;
}

function LibraryPage({ language, onPlay }: { language: Language; onPlay: (text: string) => void }) {
  const [items, setItems] = useState<LearningItem[]>([]); const [query, setQuery] = useState("");
  const [title, setTitle] = useState(""); const [text, setText] = useState("");
  const [topic, setTopic] = useState("all"); const [frequency, setFrequency] = useState("all");
  const [importing, setImporting] = useState(false); const [notice, setNotice] = useState("");
  const [batch, setBatch] = useState<ReviewBatch | null>(null); const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ target: "", cue: "", note: "", category: "", frequencyBand: "common" });
  const load = async () => {
    const path = query.trim() ? `/api/search?q=${encodeURIComponent(query)}&language=${language}&limit=100` : `/api/items?language=${language}&limit=500`;
    try { const response = await fetch(apiPath(path)); const data = await response.json() as { items: LearningItem[] }; setItems(data.items || []); }
    catch { setItems(fallbackItems[language]); }
  };
  useEffect(() => { const timeout = window.setTimeout(() => void load(), query ? 250 : 0); return () => window.clearTimeout(timeout); }, [language, query]);
  const importText = async () => {
    if (!text.trim()) return; setImporting(true); setNotice(""); setBatch(null);
    try {
      const response = await fetch(apiPath("/api/import/text"), { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, title: title.trim() || "Imported text", text }) });
      if (!response.ok) throw new Error("Import failed");
      const data = await response.json() as { batch: ReviewBatch; previewSentences: string[] };
      setBatch(data.batch); setNotice("Source saved. Select the cards you want to keep."); setTitle(""); setText("");
    } catch { setNotice("Import failed. Nothing was added to Library."); } finally { setImporting(false); }
  };
  const beginEdit = (row: LearningItem) => { setEditing(row.publicId); setEditDraft({
    target: row.target, cue: row.cue, note: row.note, category: row.tags[0] || "", frequencyBand: row.frequencyBand || "common",
  }); };
  const saveEdit = async (itemId: string) => {
    const response = await fetch(apiPath(`/api/items/${itemId}`), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      target: editDraft.target, cue: editDraft.cue, note: editDraft.note, tags: editDraft.category ? [editDraft.category] : [], frequencyBand: editDraft.frequencyBand,
    }) });
    if (response.ok) { setEditing(null); await load(); }
  };
  const deleteItem = async (itemId: string) => {
    if (!window.confirm("Delete this card from Library?")) return;
    const response = await fetch(apiPath(`/api/items/${itemId}`), { method: "DELETE" });
    if (response.ok) setItems((current) => current.filter((item) => item.publicId !== itemId));
  };
  const patternDrill = async (itemId: string) => {
    setNotice("Preparing pattern variants…");
    try { const response = await fetch(apiPath(`/api/items/${itemId}/pattern-drill`), { method: "POST" });
      if (!response.ok) throw new Error("Pattern failed"); const data = await response.json() as { batch: ReviewBatch };
      setBatch(data.batch); setNotice("Choose only the variants worth keeping.");
    } catch { setNotice("Couldn’t prepare pattern variants."); }
  };
  const topics = useMemo(() => [...new Set(items.flatMap((item) => item.tags.slice(0, 1)))].filter(Boolean).sort(), [items]);
  const visibleItems = useMemo(() => items.filter((item) =>
    (topic === "all" || item.tags.includes(topic)) && (frequency === "all" || (item.frequencyBand || "common") === frequency)), [frequency, items, topic]);
  return <main className="simple-main"><header className="simple-page-heading"><div><h1>Library</h1><p>Your approved cards and source material.</p></div></header>
    {batch ? <ReviewBatchPanel batch={batch} onBatch={setBatch} onCommitted={() => void load()} /> : null}
    <div className="simple-library-layout"><section className="simple-import-card">
      <div className="simple-section-heading"><FilePlus2 size={19} /><div><strong>Add text</strong><span>It stays a draft until you approve cards.</span></div></div>
      <input onChange={(event) => setTitle(event.target.value)} placeholder="Title or source" value={title} />
      <label className="simple-file-button"><Upload size={16} />Upload .txt<input accept=".txt,text/plain" onChange={async (event) => {
        const file = event.target.files?.[0]; if (!file) return; setTitle(file.name.replace(/\.txt$/i, "")); setText(await file.text());
      }} type="file" /></label>
      <textarea onChange={(event) => setText(event.target.value)} placeholder="Paste a text, transcript, or story…" rows={9} value={text} />
      <button className="simple-primary" disabled={!text.trim() || importing} onClick={() => void importText()} type="button">
        {importing ? <LoaderCircle className="simple-spin" size={17} /> : <Sparkles size={17} />}Prepare cards</button>
      {notice && <p className="simple-import-notice">{notice}</p>}
    </section><section className="simple-library-panel">
      <div className="simple-library-tools"><label className="simple-search"><Search size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Find a phrase or thought" type="search" value={query} /></label>
        <select aria-label="Filter by topic" onChange={(event) => setTopic(event.target.value)} value={topic}><option value="all">All topics</option>{topics.map((value) => <option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Filter by frequency" onChange={(event) => setFrequency(event.target.value)} value={frequency}><option value="all">Any frequency</option><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option></select></div>
      <div className="simple-library-count">{visibleItems.length} cards</div><div className="simple-phrase-list">
        {visibleItems.map((row) => <article className="simple-phrase-row" key={row.publicId}>
          {editing === row.publicId ? <div className="simple-library-edit"><input onChange={(event) => setEditDraft((current) => ({ ...current, target: event.target.value }))} value={editDraft.target} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, cue: event.target.value }))} value={editDraft.cue} />
            <input onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))} placeholder="Category" value={editDraft.category} />
            <select onChange={(event) => setEditDraft((current) => ({ ...current, frequencyBand: event.target.value }))} value={editDraft.frequencyBand}><option value="core">Core</option><option value="common">Common</option><option value="specific">Specific</option><option value="rare">Rare</option></select>
            <div><button onClick={() => setEditing(null)} type="button">Cancel</button><button className="is-primary" onClick={() => void saveEdit(row.publicId)} type="button">Save</button></div></div>
          : <div><strong>{row.target}</strong><small>{row.cue}</small><em>{[row.tags[0], row.frequencyBand || "common", row.currency || "current"].filter(Boolean).join(" · ")}</em></div>}
          {editing !== row.publicId ? <div className="simple-row-actions"><button aria-label="Play" onClick={() => onPlay(row.target)} type="button"><Volume2 size={16} /></button>
            <button aria-label="Pattern drill" onClick={() => void patternDrill(row.publicId)} title="Pattern drill" type="button"><WandSparkles size={16} /></button>
            <button aria-label="Edit" onClick={() => beginEdit(row)} type="button"><Pencil size={16} /></button>
            <button aria-label="Delete" onClick={() => void deleteItem(row.publicId)} type="button"><Trash2 size={16} /></button></div> : null}</article>)}
      </div></section></div>
  </main>;
}
