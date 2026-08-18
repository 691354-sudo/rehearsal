import { useState } from "react";
import {
  BookOpenText,
  ChevronDown,
  Languages,
  MessageCircleMore,
  Settings2,
  Sparkles,
} from "lucide-react";
import { LibraryView } from "./components/LibraryView";
import { PracticeSettings } from "./components/PracticeSettings";
import { PracticeView } from "./components/PracticeView";
import { TutorView } from "./components/TutorView";
import { defaultSettings, languageMeta, practiceItems } from "./data/practiceItems";
import { usePersistentState } from "./hooks/usePersistentState";
import type { LanguageCode, PracticeSettings as Settings } from "./types/practice";

type Route = "practice" | "tutor" | "library";

const navItems: Array<{
  id: Route;
  label: string;
  icon: typeof Sparkles;
}> = [
  { id: "practice", label: "Practice", icon: Sparkles },
  { id: "tutor", label: "Tutor", icon: MessageCircleMore },
  { id: "library", label: "Library", icon: BookOpenText },
];

export default function App() {
  const [route, setRoute] = usePersistentState<Route>("rehearsal:route", "practice");
  const [language, setLanguage] = usePersistentState<LanguageCode>("rehearsal:language", "en");
  const [settingsByLanguage, setSettingsByLanguage] = usePersistentState<
    Record<LanguageCode, Settings>
  >("rehearsal:settings", defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settings = settingsByLanguage[language];
  const setSettings = (nextSettings: Settings) =>
    setSettingsByLanguage((current) => ({ ...current, [language]: nextSettings }));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setRoute("practice")} type="button">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>rehearsal</strong>
            <small>personal language studio</small>
          </span>
        </button>

        <nav className="main-nav" aria-label="Основная навигация">
          {navItems.map((navItem) => {
            const Icon = navItem.icon;
            return (
              <button
                className={route === navItem.id ? "nav-item is-active" : "nav-item"}
                key={navItem.id}
                onClick={() => setRoute(navItem.id)}
                type="button"
              >
                <Icon size={19} />
                <span>{navItem.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-note">
          <Languages size={18} />
          <p><strong>Один язык за раз.</strong> Контент и прогресс English и Latvian не смешиваются.</p>
        </div>

        <button className="profile-button" type="button">
          <span>R</span>
          <span><strong>Roman</strong><small>Private workspace</small></span>
          <Settings2 size={16} />
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <strong>rehearsal</strong>
          </div>
          <div className="language-switcher" aria-label="Изучаемый язык">
            {(Object.keys(languageMeta) as LanguageCode[]).map((code) => (
              <button
                className={language === code ? "language-option is-active" : "language-option"}
                key={code}
                onClick={() => setLanguage(code)}
                type="button"
              >
                <span>{languageMeta[code].shortLabel}</span>
                {languageMeta[code].label}
              </button>
            ))}
            <ChevronDown size={15} />
          </div>
          <div className="sync-state"><span />Сохранено локально</div>
        </header>

        <div className="page-canvas">
          {route === "practice" ? (
            <PracticeView
              items={practiceItems[language]}
              language={language}
              onOpenSettings={() => setSettingsOpen(true)}
              settings={settings}
            />
          ) : null}
          {route === "tutor" ? <TutorView language={language} /> : null}
          {route === "library" ? (
            <LibraryView items={practiceItems[language]} language={language} />
          ) : null}
        </div>

        <nav className="mobile-nav" aria-label="Мобильная навигация">
          {navItems.map((navItem) => {
            const Icon = navItem.icon;
            return (
              <button
                className={route === navItem.id ? "is-active" : ""}
                key={navItem.id}
                onClick={() => setRoute(navItem.id)}
                type="button"
              >
                <Icon size={19} />
                <span>{navItem.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <PracticeSettings
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
        onReset={() => setSettings(defaultSettings[language])}
        open={settingsOpen}
        settings={settings}
      />
    </div>
  );
}
