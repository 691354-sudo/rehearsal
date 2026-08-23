import { useEffect, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import {
  languageCatalog,
  type AuthSession,
  type LanguageCode,
  type LanguageOption,
  type ProfileId,
  type ProfileSummary,
} from "../../../contracts/api";
import { RehearsalApp } from "../../app/RehearsalApp";
import { EchoLockup } from "../../app/EchoBrand";
import { defaultPracticeRoute, serializeAppRoute } from "../../lib/appRoute";
import { apiFetch, setCsrfToken } from "../../shared/api";

export function ProfileGate() {
  const invitationToken = new URLSearchParams(window.location.search).get("invite")?.trim() || "";
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selected, setSelected] = useState<ProfileId>("roman");
  const [pin, setPin] = useState(import.meta.env.DEV ? import.meta.env.VITE_CODEX_PROFILE_PIN || "" : "");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pinRef = useRef<HTMLInputElement>(null);
  const [joinLanguages, setJoinLanguages] = useState<LanguageOption[]>([]);
  const [joinAvailable, setJoinAvailable] = useState<boolean | null>(invitationToken ? null : false);
  const [joinName, setJoinName] = useState("");
  const [joinLanguage, setJoinLanguage] = useState<LanguageCode>("en");
  const applySession = (session: AuthSession) => {
    setCsrfToken(session.csrfToken);
    setProfile(session.profile);
    setAvailableLanguages(session.availableLanguages?.length
      ? session.availableLanguages : [languageCatalog.en, languageCatalog.lv]);
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
          const result = await response.json() as { available: boolean; languages: LanguageOption[] };
          setJoinAvailable(result.available);
          setJoinLanguages(result.languages);
          if (result.languages[0]) setJoinLanguage(result.languages[0].code);
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
      window.history.replaceState(null, "", serializeAppRoute(defaultPracticeRoute(joinLanguage), import.meta.env.BASE_URL));
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
      setError("Enter a PIN with 4–12 digits.");
      pinRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selected, pin }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? "Too many attempts. Try again in 15 minutes." : "Incorrect PIN.");
        window.requestAnimationFrame(() => pinRef.current?.focus());
        return;
      }
      const session = await response.json() as AuthSession;
      applySession(session);
      setPin("");
    } catch {
      setError("Could not sign in.");
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
      setAvailableLanguages([]);
      setPin("");
      setError("");
      if (!profiles.length) await loadProfiles().catch(() => setError("Profiles are unavailable."));
    }
  };

  if (loading) return <main className="profile-gate"><LoaderCircle className="simple-spin" size={24} /><span>Opening Echo…</span></main>;
  if (profile) return <RehearsalApp availableLanguages={availableLanguages} key={profile.id}
    onSwitchProfile={() => void switchProfile()} profile={profile} />;

  if (invitationToken) return <main className="profile-gate" id="main-content">
    <section className="profile-card profile-card--join">
      <EchoLockup className="profile-echo-lockup" />
      {joinAvailable ? <>
        <header><span>Say it until it’s yours.</span><h1>Create your profile</h1><p>Your cards, Tutor history, and settings will start empty.</p></header>
        <form className="profile-join-form" noValidate onSubmit={join}>
          <label htmlFor="join-name">Name</label>
          <input autoComplete="name" id="join-name" maxLength={40} onChange={(event) => {
            setJoinName(event.target.value); setError("");
          }} placeholder="Your name" value={joinName} />
          <label htmlFor="join-language">Learning language</label>
          <select id="join-language" onChange={(event) => setJoinLanguage(event.target.value as LanguageCode)} value={joinLanguage}>
            {joinLanguages.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
          </select>
          <label htmlFor="join-pin">PIN</label>
          <div className="profile-pin"><LockKeyhole size={18} /><input aria-describedby={error ? "join-error" : undefined}
            aria-invalid={Boolean(error)} autoComplete="new-password" id="join-pin" inputMode="numeric" maxLength={10}
            minLength={4} onChange={(event) => { setPin(event.target.value.replace(/\D/g, "")); setError(""); }}
            pattern="[0-9]{4,10}" placeholder="4–10 digits" ref={pinRef} type="password" value={pin} /></div>
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

  return <main className="profile-gate" id="main-content">
    <section className="profile-card">
      <EchoLockup className="profile-echo-lockup" />
      <header><span>Say it until it’s yours.</span><h1>Choose your profile</h1><p>Your practice, Tutor history, and settings stay separate.</p></header>
      <div className="profile-options" role="group" aria-label="Profiles">
        {profiles.map((candidate) => <button className={selected === candidate.id ? "is-active" : ""}
          key={candidate.id} onClick={() => { setSelected(candidate.id); setError(""); }} type="button">
          <strong>{candidate.name}</strong><span>{candidate.name.slice(0, 1).toUpperCase()}</span>
        </button>)}
      </div>
      <form noValidate onSubmit={submit}>
        <label htmlFor="profile-pin">PIN</label>
        <div className="profile-pin"><LockKeyhole size={18} /><input aria-describedby={error ? "profile-pin-error" : undefined} aria-invalid={Boolean(error)} autoComplete="current-password"
          id="profile-pin" inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "")); setError("");
          }} name="pin" pattern="[0-9]{4,12}" placeholder="For example: 1234…" ref={pinRef} type="password" value={pin} /></div>
        {error ? <p className="profile-error" id="profile-pin-error" role="alert">{error}</p> : null}
        <button className="profile-submit" disabled={submitting} type="submit">
          {submitting ? <LoaderCircle className="simple-spin" size={17} /> : null}Continue as {profiles.find((candidate) => candidate.id === selected)?.name || "profile"}
        </button>
      </form>
    </section>
  </main>;
}
