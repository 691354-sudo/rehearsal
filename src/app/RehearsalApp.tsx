import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Moon, Settings2, Sun, UserRound } from "lucide-react";
import type { ProfileSummary } from "../../contracts/api";
import { useSpeech } from "../hooks/useSpeech";
import { evaluateAttempt } from "../lib/compare";
import { clampPlaybackSpeed } from "../lib/playbackSettings";
import type { ReviewRating } from "../lib/sessionQueue";
import { LibraryPage } from "../features/library/LibraryPage";
import { PracticePage } from "../features/practice/PracticePage";
import { GlobalSettings } from "../features/settings/GlobalSettings";
import { TutorPage } from "../features/tutor/TutorPage";
import {
  defaultElevenLabsConfig,
  defaultPlayback,
  defaultSchedulerSettings,
  defaultVoices,
  languageCopy,
} from "../shared/config";
import { apiFetch } from "../shared/api";
import type {
  AttemptDraft,
  DailyProgress,
  ElevenLabsConfig,
  ElevenLabsVoiceStatus,
  Evaluation,
  Language,
  LearningItem,
  Mode,
  PlaybackPreferences,
  PlaybackResult,
  Route,
  SchedulerSettings,
  Theme,
} from "../shared/contracts";

export function RehearsalApp({ profile, onSwitchProfile }: {
  profile: ProfileSummary;
  onSwitchProfile: () => void;
}) {
  const storageKey = (name: string) => `rehearsal:${profile.id}:${name}`;
  const [route, setRoute] = useState<Route>("practice");
  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem(storageKey("language")) === "lv" ? "lv" : "en",
  );
  const [mode, setMode] = useState<Mode>("recall");
  const [attempts, setAttempts] = useState<Record<string, AttemptDraft>>({});
  const [items, setItems] = useState<LearningItem[]>([]);
  const [dueItemIds, setDueItemIds] = useState<string[]>([]);
  const [dailyProgress, setDailyProgress] = useState<DailyProgress>({ recall: 0, shadow: 0, pattern: 0 });
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey("playback")) || "{}") as Partial<PlaybackPreferences>;
      return {
        ...defaultPlayback,
        ...saved,
        elevenlabs: { ...defaultPlayback.elevenlabs, ...saved.elevenlabs },
        speed: clampPlaybackSpeed(saved.provider === "elevenlabs" ? "elevenlabs" : "openai", saved.speed ?? 1),
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
    const savedTheme = window.localStorage.getItem(storageKey("theme"));
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const { speak, stop } = useSpeech();
  const audioSequenceRef = useRef(0);
  const audioCancelRef = useRef<(() => void) | null>(null);
  const audioPauseRef = useRef<(() => void) | null>(null);
  const audioResumeRef = useRef<(() => void) | null>(null);
  const updatePlayback = useCallback((next: PlaybackPreferences) => {
    setPlayback({
      ...next,
      speed: clampPlaybackSpeed(next.provider, next.speed, elevenLabsConfig.speedRange),
    });
  }, [elevenLabsConfig.speedRange]);

  useEffect(() => {
    window.localStorage.setItem(storageKey("theme"), theme);
  }, [theme]);
  useEffect(() => {
    window.localStorage.setItem(storageKey("playback"), JSON.stringify(playback));
  }, [playback]);
  useEffect(() => {
    const speed = clampPlaybackSpeed(playback.provider, playback.speed, elevenLabsConfig.speedRange);
    if (speed !== playback.speed) setPlayback((current) => ({ ...current, speed }));
  }, [elevenLabsConfig.speedRange, playback.provider, playback.speed]);
  useEffect(() => {
    window.localStorage.setItem(storageKey("language"), language);
    if (language === "lv") setMode("recall");
    setItems([]); setDueItemIds([]); setAttempts({});
    void loadItems(language);
  }, [language]);
  useEffect(() => {
    void apiFetch("/api/config").then(async (response) => {
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
      if (data.tts?.providers?.elevenlabs) {
        setElevenLabsConfig(data.tts.providers.elevenlabs);
        if (data.tts.providers.elevenlabs.configured) {
          void apiFetch("/api/audio/elevenlabs/status").then(async (statusResponse) => {
            if (!statusResponse.ok) return;
            const status = await statusResponse.json() as ElevenLabsVoiceStatus;
            if (status.reachable) {
              setElevenLabsConfig((current) => ({
                ...current,
                voice: { id: status.voice.id, name: status.voice.name },
              }));
            }
          }).catch(() => { /* Settings exposes provider retry without blocking the app. */ });
        }
      }
    }).catch(() => setApiOnline(false));
  }, []);

  const saveSchedulerSettings = async (settings: SchedulerSettings) => {
    const response = await apiFetch("/api/settings/scheduler", {
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
      const [libraryResponse, dueResponse, progressResponse] = await Promise.all([
        apiFetch(`/api/items?language=${nextLanguage}&limit=500&includeSchedule=true`),
        apiFetch(`/api/practice/due?language=${nextLanguage}&limit=100`),
        apiFetch(`/api/practice/progress?language=${nextLanguage}&since=${encodeURIComponent(startOfDay.toISOString())}`),
      ]);
      if (!libraryResponse.ok || !dueResponse.ok || !progressResponse.ok) throw new Error("API unavailable");
      const library = await libraryResponse.json() as { items: LearningItem[] };
      const due = await dueResponse.json() as { items: LearningItem[] };
      const progress = await progressResponse.json() as DailyProgress & { completed: number };
      const dueById = new Map(due.items.map((item) => [item.publicId, item]));
      const nextItems = library.items.map((item) => dueById.get(item.publicId) || item);
      setItems(nextItems);
      setDueItemIds(due.items.map((item) => item.publicId));
      setDailyProgress({ recall: progress.recall ?? progress.completed, shadow: progress.shadow ?? 0, pattern: progress.pattern ?? 0 });
      setApiOnline(true);
    } catch { setApiOnline(false); }
  };
  const resetAttempts = () => setAttempts({});
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
    setAttempts((current) => ({ ...current, [itemId]: { answer, evaluation } }));
  };
  const commitRecall = async (itemId: string, rating: ReviewRating) => {
    const reviewedItem = items.find((candidate) => candidate.publicId === itemId);
    const attempt = attempts[itemId];
    if (!reviewedItem || !attempt?.evaluation) return false;
    try {
      const response = await apiFetch("/api/attempts/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: reviewedItem.publicId, answer: attempt.answer, mode: "recall", rating }),
      });
      if (!response.ok) throw new Error("Review failed");
      const data = await response.json() as { attempt: { schedule?: LearningItem["schedule"] } };
      setApiOnline(true);
      setDueItemIds((current) => current.filter((publicId) => publicId !== itemId));
      setItems((current) => current.map((candidate) => candidate.publicId === itemId
        ? { ...candidate, schedule: data.attempt.schedule || candidate.schedule } : candidate));
      setAttempts((current) => {
        const next = { ...current }; delete next[itemId]; return next;
      });
      setDailyProgress((progress) => ({ ...progress, recall: progress.recall + 1 }));
      return true;
    } catch {
      setApiOnline(false);
      return false;
    }
  };
  const commitListening = async (itemId: string) => {
    try {
      const response = await apiFetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, mode: "shadow", rating: "good" }),
      });
      if (!response.ok) throw new Error("Listening activity failed");
      setApiOnline(true);
      setDailyProgress((progress) => ({ ...progress, shadow: progress.shadow + 1 }));
    } catch { setApiOnline(false); }
  };
  const stopPlayback = useCallback(() => {
    audioSequenceRef.current += 1;
    audioCancelRef.current?.();
    audioCancelRef.current = null;
    audioPauseRef.current = null;
    audioResumeRef.current = null;
    stop();
  }, [stop]);
  const pausePlayback = useCallback(() => {
    if (audioPauseRef.current) audioPauseRef.current();
    else window.speechSynthesis?.pause();
  }, []);
  const resumePlayback = useCallback(() => {
    if (audioResumeRef.current) audioResumeRef.current();
    else window.speechSynthesis?.resume();
  }, []);
  const playTarget = async (
    text: string,
    overrides: Partial<PlaybackPreferences> = {},
    strictProvider = false,
  ) => {
    stopPlayback();
    const sequence = audioSequenceRef.current;
    const nextPlayback = {
      ...playback,
      ...overrides,
      elevenlabs: { ...playback.elevenlabs, ...overrides.elevenlabs },
    };
    const playAudioResponse = async (response: Response) => {
      const cacheHeader = response.headers.get("X-Audio-Cache");
      const cache = cacheHeader === "HIT" || cacheHeader === "MISS" ? cacheHeader : null;
      const url = URL.createObjectURL(await response.blob());
      for (let repetition = 0; repetition < nextPlayback.repetitions; repetition += 1) {
        if (sequence !== audioSequenceRef.current) break;
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          const finish = () => {
            audio.removeEventListener("ended", finish);
            audio.removeEventListener("error", finish);
            if (audioCancelRef.current === cancel) {
              audioCancelRef.current = null;
              audioPauseRef.current = null;
              audioResumeRef.current = null;
            }
            resolve();
          };
          const cancel = () => { audio.pause(); audio.removeAttribute("src"); finish(); };
          audioCancelRef.current = cancel;
          audioPauseRef.current = () => audio.pause();
          audioResumeRef.current = () => { void audio.play().catch(finish); };
          audio.addEventListener("ended", finish, { once: true });
          audio.addEventListener("error", finish, { once: true });
          void audio.play().catch(finish);
        });
        if (repetition < nextPlayback.repetitions - 1 && sequence === audioSequenceRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, nextPlayback.pauseMs));
        }
      }
      URL.revokeObjectURL(url);
      return cache;
    };
    if (openaiConfigured || elevenLabsConfig.configured) {
      try {
        const provider = !strictProvider && language === "lv" && nextPlayback.provider === "elevenlabs"
          ? "openai" : nextPlayback.provider;
        const response = await apiFetch("/api/audio/speech", {
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
        const cache = await playAudioResponse(response);
        return { provider, cache } satisfies PlaybackResult;
      } catch (error) {
        if (strictProvider) throw error;
        if (nextPlayback.provider === "elevenlabs") {
          try {
            const response = await apiFetch("/api/audio/speech", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, language, provider: "openai", speed: nextPlayback.speed, voice: nextPlayback.voice }),
            });
            if (response.ok) {
              const cache = await playAudioResponse(response);
              return { provider: "openai", cache } satisfies PlaybackResult;
            }
          } catch { /* Browser speech is the final fallback. */ }
        }
      }
    }
    audioPauseRef.current = () => window.speechSynthesis?.pause();
    audioResumeRef.current = () => window.speechSynthesis?.resume();
    await speak(text, {
      locale: languageCopy[language].locale,
      rate: nextPlayback.speed,
      repetitions: nextPlayback.repetitions,
      pauseMs: nextPlayback.pauseMs,
    });
    audioPauseRef.current = null;
    audioResumeRef.current = null;
    return { provider: "browser", cache: null } satisfies PlaybackResult;
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
        <button className="simple-profile-button" onClick={onSwitchProfile} title="Switch profile" type="button">
          <UserRound size={16} /><span>{profile.name}</span>
        </button>
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
      onPlayback={updatePlayback}
      onPreview={() => playTarget("This is how your tutor will sound.", { repetitions: 1 }, true)}
      onSaveScheduler={saveSchedulerSettings}
      elevenLabs={elevenLabsConfig}
      playback={playback}
      scheduler={schedulerSettings}
      voices={voices}
    /> : null}
    {route === "practice" && <PracticePage attempts={attempts} key={language}
      dueItemIds={dueItemIds} items={items} language={language} mode={mode} dailyProgress={dailyProgress}
      elevenLabs={elevenLabsConfig}
      onAnswer={setAnswer} onCheck={checkAnswer} onListened={commitListening}
      onMode={(next) => { setMode(next); resetAttempts(); }} onRecallReview={commitRecall}
      onPausePlayback={pausePlayback} onPlay={playTarget} onPlayback={updatePlayback}
      onResumePlayback={resumePlayback} onStopPlayback={stopPlayback}
      playback={playback} voices={voices} />}
    {route === "tutor" && <TutorPage language={language} profileId={profile.id} />}
    {route === "library" && <LibraryPage language={language} onAvailability={setApiOnline} onPlay={(text) => void playTarget(text)} />}
  </div>;
}
