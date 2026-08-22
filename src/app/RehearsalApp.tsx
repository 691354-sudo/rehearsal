import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Moon, Settings2, Sun, UserRound } from "lucide-react";
import { isLanguageCode, type LanguageOption, type ProfileSummary } from "../../contracts/api";
import { usePlaybackController } from "../features/audio/usePlaybackController";
import { LibraryPage } from "../features/library/LibraryPage";
import { PracticePage } from "../features/practice/PracticePage";
import { useLearningData } from "../features/practice/useLearningData";
import { GlobalSettings } from "../features/settings/GlobalSettings";
import { TutorPage } from "../features/tutor/TutorPage";
import { useAppRoute } from "../hooks/useAppRoute";
import {
  defaultLibraryRoute,
  defaultPracticeRoute,
  defaultTutorRoute,
  type AppRoute,
  type PracticeRoute,
} from "../lib/appRoute";
import {
  defaultSchedulerSettings,
  languageHasAudio,
  languageCopy,
} from "../shared/config";
import { apiFetch } from "../shared/api";
import type {
  ElevenLabsConfig,
  Language,
  SchedulerSettings,
  Theme,
} from "../shared/contracts";
import { AppLink } from "./AppLink";

export function RehearsalApp({ availableLanguages, profile, onSwitchProfile }: {
  availableLanguages: LanguageOption[];
  profile: ProfileSummary;
  onSwitchProfile: () => void;
}) {
  const storageKey = (name: string) => `rehearsal:${profile.id}:${name}`;
  const availableCodes = useMemo(() => availableLanguages.map((option) => option.code), [availableLanguages]);
  const storedLanguage = window.localStorage.getItem(storageKey("language"));
  const savedLanguage: Language = isLanguageCode(storedLanguage) && availableCodes.includes(storedLanguage)
    ? storedLanguage : availableCodes[0] || "en";
  const { route, goTo } = useAppRoute(savedLanguage, availableCodes);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [schedulerSettings, setSchedulerSettings] = useState(defaultSchedulerSettings);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem(storageKey("theme"));
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const language = route.language;
  const learning = useLearningData(language);
  const audio = usePlaybackController(profile.id, language);

  useEffect(() => {
    window.localStorage.setItem(storageKey("theme"), theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => setMobileMenuOpen(false), [route.section]);
  useEffect(() => {
    window.localStorage.setItem(storageKey("language"), language);
  }, [language]);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const firstControl = mobileMenuRef.current?.querySelector<HTMLElement>("select, button, a[href]");
    window.requestAnimationFrame(() => firstControl?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileMenuOpen(false);
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    };
  }, [mobileMenuOpen]);
  const loadConfig = async () => {
    try {
      const response = await apiFetch("/api/config");
      if (!response.ok) throw new Error("API unavailable");
      const data = await response.json() as {
        openaiConfigured: boolean;
        scheduler?: SchedulerSettings & { algorithm: string };
        tts?: {
          providers?: {
            openai?: { defaultVoice?: string; voices?: string[] };
            elevenlabs?: ElevenLabsConfig;
          };
        };
      };
      if (data.scheduler) setSchedulerSettings(data.scheduler);
      audio.applyAudioConfig(data.openaiConfigured, data.tts?.providers);
      return true;
    } catch {
      return false;
    }
  };
  useEffect(() => {
    void loadConfig();
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
    learning.setApiOnline(true);
  };
  const workspaceMode = route.section === "practice" ? route.mode : route.section === "tutor" ? route.mode : "library";
  const sectionLabel = route.section === "practice" ? "Practice" : route.section === "tutor" ? "Tutor" : "Library";
  const practiceRoute = (mode: PracticeRoute["mode"] = "recall") => ({ ...defaultPracticeRoute(language), mode });
  const changeLanguage = (nextLanguage: Language) => {
    if (!availableCodes.includes(nextLanguage)) return;
    const next: AppRoute = route.section === "tutor" && route.mode === "chat"
      ? { ...route, language: nextLanguage, thread: null }
      : route.section === "practice" && !languageHasAudio(nextLanguage) && route.mode === "listen"
      ? { ...route, language: nextLanguage, mode: "recall" }
      : { ...route, language: nextLanguage };
    goTo(next);
  };
  const openSettings = useCallback(() => goTo({ ...route, settings: true }), [goTo, route]);
  const closeSettings = useCallback(() => {
    if (window.history.state?.surface === "settings") {
      window.history.back();
      return;
    }
    goTo({ ...route, settings: false }, "replace");
  }, [goTo, route]);

  return <div className={`simple-app simple-app--${theme}`}>
    <a className="simple-skip-link" href="#main-content">Skip to Main Content</a>
    <header className="simple-header">
      <div className="simple-header-rail">
      <AppLink className="simple-brand" route={practiceRoute()}><span>R</span>
        <strong className="simple-brand-product">Rehearsal</strong><strong className="simple-brand-route">{sectionLabel}</strong></AppLink>
      <nav className="simple-nav" aria-label="Main navigation">
        <AppLink aria-current={route.section === "practice" ? "page" : undefined} className={route.section === "practice" ? "is-active" : ""} route={practiceRoute()}>Practice</AppLink>
        <AppLink aria-current={route.section === "tutor" ? "page" : undefined} className={route.section === "tutor" ? "is-active" : ""} route={defaultTutorRoute(language)}>Tutor</AppLink>
        <AppLink aria-current={route.section === "library" ? "page" : undefined} className={route.section === "library" ? "is-active" : ""} route={defaultLibraryRoute(language)}>Library</AppLink>
      </nav>
      <div className="simple-header-actions">
        <label className="simple-language"><span>{languageCopy[language].short}</span>
          <strong>{languageCopy[language].label}</strong><ChevronDown size={15} />
          <select aria-label="Language" name="language" onChange={(event) => changeLanguage(event.target.value as Language)} value={language}>
            {availableLanguages.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
          </select>
        </label>
        <button className="simple-profile-button" onClick={onSwitchProfile} title="Switch profile" type="button">
          <UserRound size={16} /><span>{profile.name}</span>
        </button>
        <button aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
          aria-pressed={theme === "dark"} className="simple-icon-button simple-theme-button"
          onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Light theme" : "Dark theme"} type="button">
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button aria-label="Settings" className="simple-icon-button simple-global-settings-button" onClick={openSettings} title="Settings" type="button"><Settings2 size={18} /></button>
      </div>
      <button aria-expanded={mobileMenuOpen} aria-label="App menu" className="simple-mobile-menu-button"
        onClick={() => setMobileMenuOpen((open) => !open)} ref={mobileMenuButtonRef} type="button"><Settings2 size={19} /></button>
      {mobileMenuOpen ? <><button aria-label="Close app menu" className="simple-mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} type="button" />
        <div className="simple-mobile-menu" ref={mobileMenuRef}>
          <label><span>Language</span><select name="mobile-language" onChange={(event) => { changeLanguage(event.target.value as Language); setMobileMenuOpen(false); }} value={language}>
            {availableLanguages.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
          <button onClick={() => { setMobileMenuOpen(false); onSwitchProfile(); }} type="button"><UserRound size={17} />{profile.name}</button>
          <button onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} type="button">
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}{theme === "dark" ? "Light theme" : "Dark theme"}</button>
          <button onClick={() => { setMobileMenuOpen(false); openSettings(); }} type="button"><Settings2 size={17} />Settings</button>
        </div></> : null}
      </div>
    </header>
    {learning.apiOnline === false ? <div className="simple-offline" role="alert">
      <span><strong>Server unavailable.</strong> Loaded cards stay on this screen; changes will work again after reconnecting.</span>
      <button onClick={() => void Promise.all([learning.loadItems(language), loadConfig()])} type="button">Try again</button>
    </div> : null}
    {audio.playbackError && !(route.section === "practice" && route.mode === "listen") && !route.settings
      ? <div className="simple-offline simple-audio-error" role="alert">
        <span><strong>Audio stopped.</strong> {audio.playbackError}</span>
        <div><button onClick={() => void audio.retryPlayback().catch(() => undefined)} type="button">Retry</button>
          <button onClick={audio.dismissPlaybackError} type="button">Dismiss</button></div>
      </div> : null}
    {route.settings ? <GlobalSettings
      language={language}
      onClose={closeSettings}
      onPlayback={audio.updatePlayback}
      onPreview={() => audio.playTarget(language === "vi"
        ? "Đây là giọng nói của gia sư của bạn."
        : language === "no" ? "Dette er stemmen til språklæreren din."
          : "This is how your tutor will sound.", { repetitions: 1 }, true)}
      onSaveScheduler={saveSchedulerSettings}
      elevenLabs={audio.elevenLabsConfig}
      playback={audio.playback}
      scheduler={schedulerSettings}
      voices={audio.voices}
    /> : null}
    <div className={`simple-workspace simple-workspace--${workspaceMode}`}>
    {route.section === "practice" && <PracticePage attempts={learning.attempts} key={language}
      dueItemIds={learning.dueItemIds} items={learning.items} language={language} route={route} dailyProgress={learning.dailyProgress}
      elevenLabs={audio.elevenLabsConfig}
      onAnswer={learning.setAnswer} onCheck={learning.checkAnswer} onListened={learning.commitListening}
      onModeSelected={learning.resetAttempts}
      onItemUpdated={learning.updateItem}
      onRoute={(next, historyMode) => { goTo(next, historyMode); learning.resetAttempts(); }} onRecallReview={learning.commitRecall}
      onPracticeEnabled={learning.updatePracticeEnabled}
      onPausePlayback={audio.pausePlayback} onPlay={audio.playTarget} onPlayback={audio.updatePlayback}
      onPlayPrepared={audio.playPreparedAudio} onPrepareAudio={audio.fetchTargetAudio}
      onResumePlayback={audio.resumePlayback} onStopPlayback={audio.stopPlayback}
      playback={audio.playback} voices={audio.voices} />}
    {route.section === "tutor" && <TutorPage language={language} profileId={profile.id} route={route}
      onRoute={(next, historyMode) => goTo(next, historyMode)}
      onLibrary={() => goTo(defaultLibraryRoute(language))}
      onListen={() => { goTo(practiceRoute("listen")); void learning.loadItems(language); }} />}
    {route.section === "library" && <LibraryPage items={learning.items} language={language} route={route}
      onRoute={(next, historyMode) => goTo(next, historyMode)}
      onItemDeleted={learning.removeItem} onItemUpdated={learning.updateItem}
      onItemsReload={() => learning.loadItems(language)}
      onListen={() => { goTo(practiceRoute("listen")); void learning.loadItems(language); }}
      onPlay={(text) => void audio.playTarget(text)} onPracticeEnabled={learning.updatePracticeEnabled}
      onReview={(itemId) => goTo({ ...practiceRoute("recall"), scope: "library", review: itemId })} />}
    </div>
  </div>;
}
