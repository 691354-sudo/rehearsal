import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole, Moon, Sun, UserRoundCheck } from "lucide-react";
import {
  languageCatalog,
  type AuthSession,
  type InvitationPurpose,
  type LanguageCode,
  type LanguageOption,
  type OnboardingState,
  type ProfileId,
  type ProfileSummary,
} from "../../../contracts/api";
import { RehearsalApp } from "../../app/RehearsalApp";
import { EchoLockup } from "../../app/EchoBrand";
import { defaultPracticeRoute, serializeAppRoute } from "../../lib/appRoute";
import { apiFetch, setCsrfToken } from "../../shared/api";
import type { Theme } from "../../shared/contracts";
import { isTelegramMiniApp, telegramInitData } from "../../lib/telegramMiniApp";
import {
  isOnboardingLocation,
  onboardingHref,
  parseOnboardingMode,
  parseOnboardingStep,
  type OnboardingMode,
} from "../onboarding/onboardingRoute";

const pilotThemeSessionKey = "rehearsal:onboarding-v1-pilot-theme";
const systemTheme = (): Theme => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const unavailableOnboarding: OnboardingState = {
  version: 1, eligibility: "none", status: "not_available", starterReady: false,
};

export function ProfileGate() {
  const invitationToken = new URLSearchParams(window.location.search).get("invite")?.trim() || "";
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState>(unavailableOnboarding);
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode | null>(null);
  const [onboardingReturnHref, setOnboardingReturnHref] = useState("");
  const [replayInvite, setReplayInvite] = useState(false);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selected, setSelected] = useState<ProfileId>("roman");
  const [pin, setPin] = useState(import.meta.env.DEV ? import.meta.env.VITE_CODEX_PROFILE_PIN || "" : "");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const telegram = isTelegramMiniApp();
  const pinRef = useRef<HTMLInputElement>(null);
  const [joinLanguages, setJoinLanguages] = useState<LanguageOption[]>([]);
  const [joinAvailable, setJoinAvailable] = useState<boolean | null>(invitationToken ? null : false);
  const [joinName, setJoinName] = useState("");
  const [joinLanguage, setJoinLanguage] = useState<LanguageCode>("en");
  const [joinExperience, setJoinExperience] = useState<InvitationPurpose>("standard");
  const [joinTheme, setJoinTheme] = useState<Theme>(systemTheme);
  const [joinThemeTouched, setJoinThemeTouched] = useState(false);
  const applySession = (session: AuthSession, forceReplay = false) => {
    setCsrfToken(session.csrfToken);
    setProfile(session.profile);
    const languages = session.availableLanguages?.length
      ? session.availableLanguages : [languageCatalog.en, languageCatalog.lv];
    setAvailableLanguages(languages);
    setOnboarding(session.onboarding || unavailableOnboarding);
    const storedTheme = window.localStorage.getItem(`rehearsal:${session.profile.id}:theme`);
    const resolvedTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : systemTheme();
    document.documentElement.style.colorScheme = resolvedTheme;
    document.documentElement.dataset.theme = resolvedTheme;

    const onboardingLocation = isOnboardingLocation(window.location);
    const requestedMode = parseOnboardingMode(window.location);
    const shouldOpen = session.onboarding?.eligibility === "pilot"
      && (session.onboarding.status === "pending" || forceReplay
        || (onboardingLocation && requestedMode === "replay"));
    if (shouldOpen) {
      const mode: OnboardingMode = session.onboarding.status === "pending" ? "first_run" : "replay";
      const step = onboardingLocation ? parseOnboardingStep(window.location) : "tutor";
      setOnboardingMode(mode);
      const destination = onboardingHref(
        step,
        session.onboarding.language || languages[0]?.code || "en",
        mode,
        import.meta.env.BASE_URL,
        session.onboarding.starterTutorThreadId,
      );
      if (`${window.location.pathname}${window.location.search}` !== destination) {
        window.history.replaceState(null, "", destination);
      }
    } else {
      setOnboardingMode(null);
      if (onboardingLocation) {
        const language = session.onboarding?.language || languages[0]?.code || "en";
        window.history.replaceState(null, "", serializeAppRoute(defaultPracticeRoute(language), import.meta.env.BASE_URL));
      }
    }
  };

  const loadProfiles = async () => {
    const response = await apiFetch("/api/auth/profiles");
    if (!response.ok) throw new Error("Profiles are unavailable");
    const data = await response.json() as { profiles: ProfileSummary[] };
    setProfiles(data.profiles);
    if (data.profiles[0]) setSelected(data.profiles[0].id);
  };

  useEffect(() => {
    void (async () => {
      try {
        if (invitationToken) {
          const response = await apiFetch(`/api/auth/invites/${encodeURIComponent(invitationToken)}`);
          if (!response.ok) throw new Error("Invitation unavailable");
          const result = await response.json() as {
            available: boolean;
            experience: InvitationPurpose;
            languages: LanguageOption[];
            replayAvailable: boolean;
          };
          setJoinAvailable(result.available);
          setJoinExperience(result.experience);
          setJoinLanguages(result.languages);
          if (result.languages[0]) setJoinLanguage(result.languages[0].code);
          if (!result.available && result.experience === "onboarding_v1_pilot" && result.replayAvailable) {
            setReplayInvite(true);
            const replayTheme = systemTheme();
            document.documentElement.style.colorScheme = replayTheme;
            document.documentElement.dataset.theme = replayTheme;
            const sessionResponse = await apiFetch("/api/auth/session");
            if (sessionResponse.ok) {
              const session = await sessionResponse.json() as AuthSession;
              if (session.onboarding.eligibility === "pilot") {
                applySession(session, true);
                return;
              }
            }
            return;
          }
          if (result.experience === "onboarding_v1_pilot") {
            try {
              const saved = JSON.parse(window.sessionStorage.getItem(pilotThemeSessionKey) || "null") as
                { theme?: Theme; touched?: boolean } | null;
              if (saved?.theme === "light" || saved?.theme === "dark") {
                setJoinTheme(saved.theme);
                setJoinThemeTouched(saved.touched === true);
              } else {
                setJoinTheme(systemTheme());
              }
            } catch {
              setJoinTheme(systemTheme());
            }
          }
          return;
        }
        if (telegram) {
          const telegramResponse = await apiFetch("/api/auth/telegram/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: telegramInitData() }),
          });
          if (telegramResponse.ok) {
            applySession(await telegramResponse.json() as AuthSession);
            return;
          }
          const failure = await telegramResponse.json().catch(() => null) as {
            error?: string;
            profiles?: ProfileSummary[];
          } | null;
          if (failure?.error === "TELEGRAM_BINDING_REQUIRED") {
            const allowed = failure.profiles || [];
            setProfiles(allowed);
            if (allowed[0]) setSelected(allowed[0].id);
            if (!allowed.length) setError("This Telegram bot is not enabled for any Echo profile yet.");
            return;
          }
          setError(failure?.error === "TELEGRAM_INIT_DATA_EXPIRED"
            ? "Reopen Echo from Telegram to continue."
            : "Telegram sign-in could not be verified.");
          return;
        }
        const response = await apiFetch("/api/auth/session");
        if (response.ok) {
          const session = await response.json() as AuthSession;
          applySession(session);
          return;
        }
        await loadProfiles();
      } catch {
        setError("Echo is unavailable right now.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (joinExperience !== "onboarding_v1_pilot" || replayInvite) return;
    document.documentElement.style.colorScheme = joinTheme;
    document.documentElement.dataset.theme = joinTheme;
    window.sessionStorage.setItem(pilotThemeSessionKey, JSON.stringify({
      theme: joinTheme, touched: joinThemeTouched,
    }));
  }, [joinExperience, joinTheme, joinThemeTouched, replayInvite]);

  useEffect(() => {
    if (joinExperience !== "onboarding_v1_pilot" || joinThemeTouched || replayInvite) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setJoinTheme(media.matches ? "dark" : "light");
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [joinExperience, joinThemeTouched, replayInvite]);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    const name = joinName.trim().replace(/\s+/g, " ");
    if (!name || name.length > 40) {
      setError("Enter a name with up to 40 characters.");
      return;
    }
    if (!/^\d{4,10}$/.test(pin)) {
      setError("Choose a PIN with 4–10 digits.");
      pinRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: invitationToken, name, pin, language: joinLanguage }),
      });
      if (!response.ok) {
        const message = response.status === 409 ? "That profile name is already in use."
          : response.status === 410 ? "This invitation has already been used."
            : response.status === 429 ? "Too many attempts. Try again in 15 minutes."
              : "Could not create the profile.";
        setError(message);
        return;
      }
      const session = await response.json() as AuthSession;
      if (joinExperience === "onboarding_v1_pilot" && joinThemeTouched) {
        window.localStorage.setItem(`rehearsal:${session.profile.id}:theme`, joinTheme);
      }
      window.sessionStorage.removeItem(pilotThemeSessionKey);
      applySession(session);
      setPin("");
    } catch {
      setError("Could not create the profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!/^\d{4,12}$/.test(pin)) {
      setError(replayInvite ? "Введите PIN из 4–12 цифр." : "Enter a PIN with 4–12 digits.");
      pinRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch(telegram ? "/api/auth/telegram/bind"
        : replayInvite ? "/api/auth/pilot-replay" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(telegram
          ? { initData: telegramInitData(), profileId: selected, pin }
          : replayInvite ? { token: invitationToken, pin } : { profileId: selected, pin }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? replayInvite ? "Слишком много попыток. Попробуйте снова через 15 минут." : "Too many attempts. Try again in 15 minutes."
          : response.status === 409 ? "This Telegram account is already connected to another Echo profile."
            : response.status === 403 ? "This profile is not enabled for this test bot."
              : replayInvite ? "Неверный PIN тестового профиля." : "Incorrect PIN.");
        window.requestAnimationFrame(() => pinRef.current?.focus());
        return;
      }
      const session = await response.json() as AuthSession;
      applySession(session, replayInvite);
      setPin("");
    } catch {
      setError(replayInvite
        ? "Не удалось открыть онбординг. Проверьте соединение и попробуйте снова."
        : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const switchProfile = async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setCsrfToken("");
      setProfile(null);
      setOnboarding(unavailableOnboarding);
      setOnboardingMode(null);
      setReplayInvite(false);
      setAvailableLanguages([]);
      setPin("");
      setError("");
      if (!profiles.length) await loadProfiles().catch(() => setError("Profiles are unavailable."));
    }
  };

  if (loading) return <main className="profile-gate"><LoaderCircle className="simple-spin" size={24} /><span>Opening Echo…</span></main>;
  if (profile) return <RehearsalApp availableLanguages={availableLanguages} key={profile.id}
    onboarding={onboarding} onboardingMode={onboardingMode}
    onCloseOnboarding={() => {
      const destination = onboardingReturnHref
        || serializeAppRoute(defaultPracticeRoute(onboarding.language || availableLanguages[0]?.code || "en"), import.meta.env.BASE_URL);
      window.history.replaceState(null, "", destination);
      window.dispatchEvent(new Event("app-routechange"));
      setOnboardingMode(null);
      setOnboardingReturnHref("");
    }}
    onCompleteOnboarding={(state) => {
      setOnboarding(state);
      window.history.replaceState(null, "", serializeAppRoute(
        defaultPracticeRoute(state.language || availableLanguages[0]?.code || "en"), import.meta.env.BASE_URL,
      ));
      window.dispatchEvent(new Event("app-routechange"));
      setOnboardingMode(null);
    }}
    onReplayOnboarding={() => {
      setOnboardingReturnHref(`${window.location.pathname}${window.location.search}`);
      window.history.pushState(null, "", onboardingHref(
        "tutor",
        onboarding.language || availableLanguages[0]?.code || "en",
        "replay",
        import.meta.env.BASE_URL,
        onboarding.starterTutorThreadId,
      ));
      window.dispatchEvent(new Event("app-routechange"));
      setOnboardingMode("replay");
    }}
    onSwitchProfile={() => void switchProfile()} profile={profile} />;

  if (invitationToken && !replayInvite) return <main className={`profile-gate${joinExperience === "onboarding_v1_pilot"
    ? " profile-gate--pilot-theme" : ""}`} id="main-content">
    <section className="profile-card profile-card--join">
      <EchoLockup className="profile-echo-lockup" />
      {joinAvailable ? <>
        <header><span>Say it until it’s yours.</span><h1>Create your profile</h1><p>{joinExperience === "onboarding_v1_pilot"
          ? "We’ll add six example cards so you can try Echo right away."
          : "Your cards, Tutor history, and settings will start empty."}</p></header>
        <form className="profile-join-form" noValidate onSubmit={join}>
          <label htmlFor="join-name">Name</label>
          <input autoComplete="name" id="join-name" maxLength={40} name="name" onChange={(event) => {
            setJoinName(event.target.value); setError("");
          }} placeholder="Your name" value={joinName} />
          <label htmlFor="join-language">Learning language</label>
          <select id="join-language" name="learning-language" onChange={(event) => setJoinLanguage(event.target.value as LanguageCode)} value={joinLanguage}>
            {joinLanguages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
          {joinExperience === "onboarding_v1_pilot" ? <fieldset className="profile-theme-choice">
            <legend>Оформление</legend>
            <div aria-label="Тема оформления">
              <button aria-pressed={joinTheme === "light"} className={joinTheme === "light" ? "is-active" : ""}
                onClick={() => { setJoinTheme("light"); setJoinThemeTouched(true); }} type="button">
                <Sun aria-hidden="true" size={16} />Светлая
              </button>
              <button aria-pressed={joinTheme === "dark"} className={joinTheme === "dark" ? "is-active" : ""}
                onClick={() => { setJoinTheme("dark"); setJoinThemeTouched(true); }} type="button">
                <Moon aria-hidden="true" size={16} />Тёмная
              </button>
            </div>
            <small>По умолчанию используется тема устройства.</small>
          </fieldset> : null}
          <label htmlFor="join-pin">PIN</label>
          <div className="profile-pin"><LockKeyhole size={18} /><input aria-describedby={error ? "join-error" : undefined}
            aria-invalid={Boolean(error)} autoComplete="new-password" id="join-pin" inputMode="numeric" maxLength={10}
            minLength={4} onChange={(event) => { setPin(event.target.value.replace(/\D/g, "")); setError(""); }}
            name="pin" pattern="[0-9]{4,10}" placeholder="4–10 digits" ref={pinRef} type="password" value={pin} /></div>
          <small>Use this PIN when you return to Echo.</small>
          {error ? <p className="profile-error" id="join-error" role="alert">{error}</p> : null}
          <button className="profile-submit" disabled={submitting} type="submit">
            {submitting ? <LoaderCircle className="simple-spin" size={17} /> : null}Create profile
          </button>
        </form>
      </> : <header><span>Say it until it’s yours.</span><h1>Invitation unavailable</h1>
        <p>This link has already been used or is not valid. Ask for a new invitation.</p></header>}
    </section>
  </main>;

  return <main className={`profile-gate${replayInvite ? " profile-gate--pilot-theme" : ""}`} id="main-content">
    <section className="profile-card">
      <EchoLockup className="profile-echo-lockup" />
      <header><span>Say it until it’s yours.</span><h1>{telegram ? "Connect Telegram to Echo" : replayInvite ? "Открыть тестовый онбординг" : "Choose your profile"}</h1>
        <p>{telegram ? "Choose your Echo profile and enter its PIN once. This Telegram account will reconnect automatically."
          : replayInvite ? "Введите PIN, который вы задали при создании тестового профиля Echo. Карточки и данные не будут созданы повторно."
          : "Your practice, Tutor history, and settings stay separate."}</p></header>
      {replayInvite ? <div className="profile-replay-identity">
        <UserRoundCheck aria-hidden="true" size={22} />
        <div><strong>Echo Test</strong><span>Тестовый профиль онбординга</span></div>
      </div> : <div className="profile-options" role="group" aria-label="Profiles">
        {profiles.map((candidate) => <button className={selected === candidate.id ? "is-active" : ""}
          key={candidate.id} onClick={() => { setSelected(candidate.id); setError(""); }} type="button">
          <strong>{candidate.name}</strong><span>{candidate.name.slice(0, 1).toUpperCase()}</span>
        </button>)}
      </div>}
      <form noValidate onSubmit={submit}>
        <label htmlFor="profile-pin">PIN</label>
        <div className="profile-pin"><LockKeyhole size={18} /><input aria-describedby={error ? "profile-pin-error" : undefined} aria-invalid={Boolean(error)} autoComplete="current-password"
          id="profile-pin" inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "")); setError("");
          }} name="pin" pattern="[0-9]{4,12}" placeholder={replayInvite ? "Например: 1234…" : "For example: 1234…"} ref={pinRef} type="password" value={pin} /></div>
        {error ? <p className="profile-error" id="profile-pin-error" role="alert">{error}</p> : null}
        <button className="profile-submit" disabled={submitting} type="submit">
          {submitting ? <LoaderCircle className="simple-spin" size={17} /> : null}{telegram ? "Connect Telegram"
            : replayInvite ? "Открыть онбординг" : `Continue as ${profiles.find((candidate) => candidate.id === selected)?.name || "profile"}`}
        </button>
      </form>
    </section>
  </main>;
}
