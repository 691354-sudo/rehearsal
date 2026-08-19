import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Headphones, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { apiPath } from "../lib/api";

type Language = "en" | "lv";
type Provider = "openai" | "elevenlabs";
type ElevenLabsConfig = {
  configured: boolean;
  voice: { id: string; name: string };
  models: Array<"eleven_multilingual_v2" | "eleven_flash_v2_5">;
  speedRange: { min: number; max: number };
  defaults: {
    modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
    stability: number;
    similarityBoost: number;
    style: number;
    speakerBoost: boolean;
    speed: number;
  };
};
type Topic = { islandId: string; title: string; count: number };
type Settings = {
  provider: Provider;
  voice: string;
  speed: number;
  pauseSeconds: number;
  repetitions: number;
  modelId?: "eleven_multilingual_v2" | "eleven_flash_v2_5";
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speakerBoost?: boolean;
};
type Track = {
  publicId: string;
  topicTitle: string;
  snapshot: Array<{ publicId: string; target: string }>;
  settings: Settings;
  status: "building" | "ready" | "failed";
  durationSeconds: number | null;
  error: string;
};

const storageKey = "rehearsal:saturation-settings";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const formatDuration = (seconds: number | null) => {
  if (!seconds) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
};

export function SaturationPanel(props: {
  language: Language;
  openaiConfigured: boolean;
  voices: string[];
  elevenLabs: ElevenLabsConfig;
}) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [islandId, setIslandId] = useState("");
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<Settings>;
      const next = { provider: "openai" as Provider, voice: "marin", speed: 1, pauseSeconds: 1.5, repetitions: 2, ...saved };
      if (next.provider === "elevenlabs") {
        next.speed = clamp(next.speed, props.elevenLabs.speedRange.min, props.elevenLabs.speedRange.max);
      }
      return next;
    } catch {
      return { provider: "openai", voice: "marin", speed: 1, pauseSeconds: 1.5, repetitions: 2 };
    }
  });
  const [track, setTrack] = useState<Track | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [notice, setNotice] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef("");
  const directUrl = track?.status === "ready" ? apiPath(`/api/saturation/tracks/${track.publicId}/audio`) : "";
  const clearAudio = () => {
    audioRef.current?.pause();
    setAudioUrl("");
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = ""; }
  };

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    setTopics([]); setIslandId(""); setTrack(null); setNotice(""); clearAudio();
    void fetch(apiPath(`/api/saturation/topics?language=${props.language}`)).then(async (response) => {
      if (!response.ok) throw new Error("Topics could not be loaded.");
      const data = await response.json() as { topics: Topic[] };
      if (cancelled) return;
      setTopics(data.topics); setIslandId(data.topics[0]?.islandId || "");
    }).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Topics could not be loaded."); });
    return () => { cancelled = true; };
  }, [props.language]);

  useEffect(() => {
    if (track?.status !== "building") return;
    const timer = window.setInterval(() => {
      void fetch(apiPath(`/api/saturation/tracks/${track.publicId}`)).then(async (response) => {
        if (!response.ok) throw new Error("Track status unavailable");
        const data = await response.json() as { track: Track };
        setTrack(data.track);
        if (data.track.status === "failed") setNotice("Audio preparation failed. Retry when the provider is available.");
      }).catch(() => setNotice("Waiting for the server…"));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [track?.publicId, track?.status]);

  useEffect(() => {
    if (track?.status !== "ready") return;
    const controller = new AbortController();
    setLoadingAudio(true); setNotice("Loading the complete track for your walk…");
    void fetch(apiPath(`/api/saturation/tracks/${track.publicId}/audio`), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("The MP3 could not be loaded.");
      const url = URL.createObjectURL(await response.blob());
      if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = url; setAudioUrl(url); setNotice("Track loaded. Press Play, lock the screen, and put the phone in your pocket.");
    }).catch((error) => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "The MP3 could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoadingAudio(false); });
    return () => controller.abort();
  }, [track?.publicId, track?.status]);

  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

  useEffect(() => {
    if (!track || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.topicTitle,
      artist: "Rehearsal · Saturation",
      album: props.language === "en" ? "English" : "Latvian",
    });
  }, [props.language, track]);

  const available = settings.provider === "openai" ? props.openaiConfigured : props.elevenLabs.configured;
  const speedRange = settings.provider === "elevenlabs" ? props.elevenLabs.speedRange : { min: 0.5, max: 1.5 };
  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setTrack(null); setNotice(""); clearAudio();
  };
  const selectProvider = (provider: Provider) => updateSettings(provider === "openai"
    ? { provider, voice: props.voices.includes(settings.voice) ? settings.voice : (props.voices[0] || "marin"), modelId: undefined }
    : {
      provider, voice: props.elevenLabs.voice.id, speed: props.elevenLabs.defaults.speed,
      modelId: props.elevenLabs.defaults.modelId, stability: props.elevenLabs.defaults.stability,
      similarityBoost: props.elevenLabs.defaults.similarityBoost, style: props.elevenLabs.defaults.style,
      speakerBoost: props.elevenLabs.defaults.speakerBoost,
    });
  const prepare = async () => {
    if (!islandId || preparing || !available) return;
    setPreparing(true); setNotice("Preparing one continuous MP3…"); clearAudio();
    try {
      const response = await fetch(apiPath("/api/saturation/tracks"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: props.language, islandId, settings }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(data?.message || "Audio preparation could not start.");
      }
      const data = await response.json() as { track: Track };
      setTrack(data.track);
      if (data.track.status === "ready") setNotice("Cached track found. Loading it now…");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Audio preparation could not start."); }
    finally { setPreparing(false); }
  };
  const play = () => void audioRef.current?.play().catch(() => setNotice("Brave blocked playback. Tap Open in player below."));
  const selectedTopic = useMemo(() => topics.find((topic) => topic.islandId === islandId), [islandId, topics]);

  return <section className="saturation-panel">
    <header><div><Headphones size={20} /><h2>Audio Saturation</h2></div><p>One continuous target-language track designed to keep playing while you walk.</p></header>
    <div className="saturation-settings">
      <label><span>Topic</span><select disabled={!topics.length} onChange={(event) => { setIslandId(event.target.value); setTrack(null); clearAudio(); }} value={islandId}>
        {!topics.length ? <option value="">No topics</option> : topics.map((topic) => <option key={topic.islandId} value={topic.islandId}>{topic.title} · {topic.count}</option>)}
      </select></label>
      <fieldset><legend>Voice provider</legend><div className="saturation-provider">
        <button className={settings.provider === "openai" ? "is-active" : ""} onClick={() => selectProvider("openai")} type="button">OpenAI</button>
        <button className={settings.provider === "elevenlabs" ? "is-active" : ""} onClick={() => selectProvider("elevenlabs")} type="button">ElevenLabs</button>
      </div></fieldset>
      <label><span>Voice</span>{settings.provider === "openai" ? <select onChange={(event) => updateSettings({ voice: event.target.value })} value={settings.voice}>
        {props.voices.map((voice) => <option key={voice} value={voice}>{voice}</option>)}</select> :
        <select disabled value={props.elevenLabs.voice.id}><option value={props.elevenLabs.voice.id}>{props.elevenLabs.voice.name}</option></select>}</label>
      <label><span>Speed <strong>{settings.speed.toFixed(2)}×</strong></span><input max={speedRange.max} min={speedRange.min} onChange={(event) => updateSettings({ speed: Number(event.target.value) })} step="0.05" type="range" value={settings.speed} /></label>
      <label><span>Pause <strong>{settings.pauseSeconds.toFixed(1)}s</strong></span><input max="10" min="0.5" onChange={(event) => updateSettings({ pauseSeconds: Number(event.target.value) })} step="0.5" type="range" value={settings.pauseSeconds} /></label>
      <label><span>Repeats</span><select onChange={(event) => updateSettings({ repetitions: Number(event.target.value) })} value={settings.repetitions}>
        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
    </div>
    <div className="saturation-summary">
      <span>{selectedTopic ? `${selectedTopic.count} phrases · target language only` : "Cards need a first topic tag"}
        {settings.provider === "elevenlabs" ? <small>Phrase audio and the finished MP3 are cached on this server.</small> : null}</span>
      {!available ? <strong>{settings.provider === "openai" ? "Connect OpenAI in .env" : "Connect ElevenLabs in .env.elevenlabs"}</strong> : null}
    </div>
    <div className="saturation-player">
      <audio controls={Boolean(audioUrl)} preload="auto" ref={audioRef} src={audioUrl || undefined} />
      <div><button className="simple-primary" disabled={!islandId || !available || preparing || track?.status === "building"} onClick={() => void prepare()} type="button">
        {preparing || track?.status === "building" ? <LoaderCircle className="simple-spin" size={15} /> : track?.status === "failed" ? <RefreshCw size={15} /> : <Headphones size={15} />}
        {track?.status === "building" ? "Preparing audio" : track?.status === "failed" ? "Retry" : "Prepare audio"}
      </button>
      <button disabled={!audioUrl || loadingAudio} onClick={play} type="button"><Play fill="currentColor" size={15} />Play</button></div>
      {track?.status === "ready" ? <span>{track.snapshot.length} phrases · {track.settings.repetitions}× · {formatDuration(track.durationSeconds)}</span> : null}
      <p aria-live="polite">{loadingAudio ? "Loading the complete MP3…" : notice}</p>
      {directUrl ? <a href={directUrl} rel="noreferrer" target="_blank"><ExternalLink size={14} />Open in player</a> : null}
    </div>
  </section>;
}
