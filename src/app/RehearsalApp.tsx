import { useEffect, useState } from "react";
import { ChevronDown, Moon, Settings2, Sun, UserRound } from "lucide-react";
import type { ProfileSummary } from "../../contracts/api";
import { usePlaybackController } from "../features/audio/usePlaybackController";
import { LibraryPage } from "../features/library/LibraryPage";
import { PracticePage } from "../features/practice/PracticePage";
import { useLearningData } from "../features/practice/useLearningData";
import { GlobalSettings } from "../features/settings/GlobalSettings";
import { TutorPage } from "../features/tutor/TutorPage";
import {
  defaultSchedulerSettings,
  languageCopy,
} from "../shared/config";
import { apiFetch } from "../shared/api";
import type {
  ElevenLabsConfig,
  Language,
  Mode,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [language, setLanguage] = useState<Language>(() =>
    window.localStorage.getItem(storageKey("language")) === "lv" ? "lv" : "en",
  );
  const [mode, setMode] = useState<Mode>("recall");
  const [tutorMode, setTutorMode] = useState<"chat" | "notebook">("chat");
  const [manualReviewItemId, setManualReviewItemId] = useState<string | null>(null);
  const [schedulerSettings, setSchedulerSettings] = useState(defaultSchedulerSettings);
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem(storageKey("theme"));
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const learning = useLearningData(language);
  const audio = usePlaybackController(profile.id, language);

  useEffect(() => {
    window.localStorage.setItem(storageKey("theme"), theme);
  }, [theme]);
  useEffect(() => setMobileMenuOpen(false), [route]);
  useEffect(() => {
    window.localStorage.setItem(storageKey("language"), language);
    if (language === "lv") setMode("recall");
  }, [language]);
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
  const workspaceMode = route === "practice"
    ? mode === "shadow" ? "listen" : "recall"
    : route === "tutor" ? tutorMode : "library";

  return <div className={`simple-app simple-app--${theme}`}>
    <header className="simple-header">
      <button className="simple-brand" onClick={() => setRoute("practice")} type="button"><span>R</span>
        <strong className="simple-brand-product">Rehearsal</strong><strong className="simple-brand-route">{route === "practice" ? "Practice" : route === "tutor" ? "Tutor" : "Library"}</strong></button>
      <nav className="simple-nav" aria-label="Main navigation">
        <button className={route === "practice" ? "is-active" : ""} onClick={() => setRoute("practice")} type="button">Practice</button>
        <button className={route === "tutor" ? "is-active" : ""} onClick={() => setRoute("tutor")} type="button">Tutor</button>
        <button className={route === "library" ? "is-active" : ""} onClick={() => setRoute("library")} type="button">Library</button>
      </nav>
      <div className="simple-header-actions">
        <label className="simple-language"><span>{languageCopy[language].short}</span>
          <strong>{languageCopy[language].label}</strong><ChevronDown size={15} />
          <select aria-label="Language" onChange={(event) => setLanguage(event.target.value as Language)} value={language}>
            <option value="en">English</option><option value="lv">Latviešu</option>
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
        <button aria-label="Settings" className="simple-icon-button simple-global-settings-button" onClick={() => setGlobalSettingsOpen(true)} title="Settings" type="button"><Settings2 size={18} /></button>
      </div>
      <button aria-expanded={mobileMenuOpen} aria-label="App menu" className="simple-mobile-menu-button"
        onClick={() => setMobileMenuOpen((open) => !open)} type="button"><Settings2 size={19} /></button>
      {mobileMenuOpen ? <><button aria-label="Close app menu" className="simple-mobile-menu-backdrop" onClick={() => setMobileMenuOpen(false)} type="button" />
        <div className="simple-mobile-menu">
          <label><span>Language</span><select onChange={(event) => { setLanguage(event.target.value as Language); setMobileMenuOpen(false); }} value={language}>
            <option value="en">English</option><option value="lv">Latviešu</option></select></label>
          <button onClick={() => { setMobileMenuOpen(false); onSwitchProfile(); }} type="button"><UserRound size={17} />{profile.name}</button>
          <button onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} type="button">
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}{theme === "dark" ? "Light theme" : "Dark theme"}</button>
          <button onClick={() => { setMobileMenuOpen(false); setGlobalSettingsOpen(true); }} type="button"><Settings2 size={17} />Settings</button>
        </div></> : null}
    </header>
    {learning.apiOnline === false ? <div className="simple-offline" role="alert">
      <span><strong>Server unavailable.</strong> Loaded cards stay on this screen; changes will work again after reconnecting.</span>
      <button onClick={() => void Promise.all([learning.loadItems(language), loadConfig()])} type="button">Try again</button>
    </div> : null}
    {globalSettingsOpen ? <GlobalSettings
      onClose={() => setGlobalSettingsOpen(false)}
      onPlayback={audio.updatePlayback}
      onPreview={() => audio.playTarget("This is how your tutor will sound.", { repetitions: 1 }, true)}
      onSaveScheduler={saveSchedulerSettings}
      elevenLabs={audio.elevenLabsConfig}
      playback={audio.playback}
      scheduler={schedulerSettings}
      voices={audio.voices}
    /> : null}
    <div className={`simple-workspace simple-workspace--${workspaceMode}`}>
    {route === "practice" && <PracticePage attempts={learning.attempts} key={language}
      dueItemIds={learning.dueItemIds} items={learning.items} language={language} mode={mode} dailyProgress={learning.dailyProgress}
      elevenLabs={audio.elevenLabsConfig} manualReviewItemId={manualReviewItemId}
      onAnswer={learning.setAnswer} onCheck={learning.checkAnswer} onListened={learning.commitListening}
      onItemUpdated={learning.updateItem}
      onManualReviewStarted={() => setManualReviewItemId(null)}
      onMode={(next) => { setMode(next); learning.resetAttempts(); }} onRecallReview={learning.commitRecall}
      onPracticeEnabled={learning.updatePracticeEnabled}
      onPausePlayback={audio.pausePlayback} onPlay={audio.playTarget} onPlayback={audio.updatePlayback}
      onResumePlayback={audio.resumePlayback} onStopPlayback={audio.stopPlayback}
      onVoiceSettings={() => setGlobalSettingsOpen(true)}
      playback={audio.playback} voices={audio.voices} />}
    {route === "tutor" && <TutorPage language={language} mode={tutorMode} onMode={setTutorMode} profileId={profile.id}
      onLibrary={() => setRoute("library")}
      onListen={() => { setMode("shadow"); setRoute("practice"); void learning.loadItems(language); }} />}
    {route === "library" && <LibraryPage items={learning.items} language={language}
      onItemDeleted={learning.removeItem} onItemUpdated={learning.updateItem}
      onItemsReload={() => learning.loadItems(language)}
      onListen={() => { setMode("shadow"); setRoute("practice"); void learning.loadItems(language); }}
      onPlay={(text) => void audio.playTarget(text)} onPracticeEnabled={learning.updatePracticeEnabled}
      onReview={(itemId) => { setManualReviewItemId(itemId); setMode("recall"); setRoute("practice"); }} />}
    </div>
  </div>;
}
