import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import type { AuthSession, ProfileId, ProfileSummary } from "../../../contracts/api";
import { RehearsalApp } from "../../app/RehearsalApp";
import { apiFetch, setCsrfToken } from "../../shared/api";

export function ProfileGate() {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selected, setSelected] = useState<ProfileId>("roman");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
        const response = await apiFetch("/api/auth/session");
        if (response.ok) {
          const session = await response.json() as AuthSession;
          setCsrfToken(session.csrfToken);
          setProfile(session.profile);
          return;
        }
        await loadProfiles();
      } catch {
        setError("Rehearsal is unavailable right now.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4,12}$/.test(pin) || submitting) return;
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
        return;
      }
      const session = await response.json() as AuthSession;
      setCsrfToken(session.csrfToken);
      setPin("");
      setProfile(session.profile);
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
      setPin("");
      setError("");
      if (!profiles.length) await loadProfiles().catch(() => setError("Profiles are unavailable."));
    }
  };

  if (loading) return <main className="profile-gate"><LoaderCircle className="simple-spin" size={24} /><span>Opening Rehearsal…</span></main>;
  if (profile) return <RehearsalApp key={profile.id} onSwitchProfile={() => void switchProfile()} profile={profile} />;

  return <main className="profile-gate">
    <section className="profile-card">
      <div className="profile-mark">R</div>
      <header><span>Rehearsal</span><h1>Choose your profile</h1><p>Your practice, Tutor history, and settings stay separate.</p></header>
      <div className="profile-options" role="group" aria-label="Profiles">
        {profiles.map((candidate) => <button className={selected === candidate.id ? "is-active" : ""}
          key={candidate.id} onClick={() => { setSelected(candidate.id); setError(""); }} type="button">
          <strong>{candidate.name}</strong><span>{candidate.id === "roman" ? "R" : "O"}</span>
        </button>)}
      </div>
      <form onSubmit={submit}>
        <label htmlFor="profile-pin">PIN</label>
        <div className="profile-pin"><LockKeyhole size={18} /><input autoComplete="current-password" autoFocus
          id="profile-pin" inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "")); setError("");
          }} pattern="[0-9]{4,12}" placeholder="4–12 digits" type="password" value={pin} /></div>
        {error ? <p className="profile-error" role="alert">{error}</p> : null}
        <button className="profile-submit" disabled={!/^\d{4,12}$/.test(pin) || submitting} type="submit">
          {submitting ? <LoaderCircle className="simple-spin" size={17} /> : null}Continue as {profiles.find((candidate) => candidate.id === selected)?.name || "profile"}
        </button>
      </form>
    </section>
  </main>;
}
