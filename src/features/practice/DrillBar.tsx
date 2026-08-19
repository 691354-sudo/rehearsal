import { useEffect, useRef, useState } from "react";
import { ListMusic, LoaderCircle, Pause, Play, RotateCcw, Settings2, Square } from "lucide-react";
import { apiPath } from "../../shared/config";

type Language = "en" | "lv";
type Provider = "openai" | "elevenlabs";
type DrillItem = { publicId: string; target: string };
type Playback = {
  provider: Provider;
  repetitions: number;
  speed: number;
  pauseMs: number;
  voice: string;
  elevenlabs: {
    modelId: "eleven_multilingual_v2" | "eleven_flash_v2_5";
    stability: number;
    similarityBoost: number;
    style: number;
    speakerBoost: boolean;
  };
};
type Status = "idle" | "loading" | "playing" | "paused" | "complete" | "error";

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function DrillBar(props: {
  arranging: boolean;
  elevenLabsConfigured: boolean;
  elevenLabsVoiceId: string;
  items: DrillItem[];
  language: Language;
  loopIds: string[];
  onArrange: () => void;
  onBeforeStart: () => void;
  onSettings: () => void;
  onState: (status: Status, currentId: string) => void;
  openaiConfigured: boolean;
  playback: Playback;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [currentId, setCurrentId] = useState("");
  const [currentLabel, setCurrentLabel] = useState("");
  const [position, setPosition] = useState({ current: 0, total: 0, looping: false });
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const pausedRef = useRef(false);
  const objectUrlRef = useRef("");
  const finishAudioRef = useRef<(() => void) | null>(null);
  const pauseActionRef = useRef<() => void>(() => undefined);
  const resumeActionRef = useRef<() => void>(() => undefined);
  const stopActionRef = useRef<() => void>(() => undefined);

  const clearAudio = () => {
    finishAudioRef.current?.();
    finishAudioRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
  };

  const stop = () => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pausedRef.current = false;
    clearAudio();
    setStatus("idle");
    setCurrentId("");
    setCurrentLabel("");
    setPosition({ current: 0, total: 0, looping: false });
    setError("");
  };

  const pause = () => {
    if (!(["loading", "playing"] as Status[]).includes(status)) return;
    pausedRef.current = true;
    audioRef.current?.pause();
    setStatus("paused");
  };

  const resume = () => {
    if (status !== "paused") return;
    pausedRef.current = false;
    setError("");
    setStatus(audioRef.current?.src ? "playing" : "loading");
    if (audioRef.current?.src && !audioRef.current.ended) {
      void audioRef.current.play().catch(() => {
        pausedRef.current = true;
        setStatus("paused");
        setError("Tap Play again to let Brave resume audio.");
      });
    }
  };

  pauseActionRef.current = pause;
  resumeActionRef.current = resume;
  stopActionRef.current = stop;

  useEffect(() => {
    props.onState(status, currentId);
  }, [currentId, props.onState, status]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => resumeActionRef.current());
    navigator.mediaSession.setActionHandler("pause", () => pauseActionRef.current());
    navigator.mediaSession.setActionHandler("stop", () => stopActionRef.current());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("stop", null);
    };
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    abortRef.current?.abort();
    clearAudio();
  }, []);

  const waitUntilResumed = async (run: number) => {
    while (pausedRef.current && run === runRef.current) await delay(80);
    return run === runRef.current;
  };

  const waitForPause = async (milliseconds: number, run: number) => {
    let remaining = milliseconds;
    while (remaining > 0 && run === runRef.current) {
      if (!(await waitUntilResumed(run))) return false;
      const slice = Math.min(100, remaining);
      await delay(slice);
      if (!pausedRef.current) remaining -= slice;
    }
    return run === runRef.current;
  };

  const fetchAudio = async (item: DrillItem, run: number) => {
    if (!(await waitUntilResumed(run))) return null;
    setStatus(pausedRef.current ? "paused" : "loading");
    const controller = new AbortController();
    abortRef.current = controller;
    const provider = props.language === "lv" && props.playback.provider === "elevenlabs"
      ? "openai" : props.playback.provider;
    const response = await fetch(apiPath("/api/audio/speech"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        text: item.target,
        language: props.language,
        provider,
        speed: props.playback.speed,
        voice: props.playback.voice,
        voiceId: props.elevenLabsVoiceId,
        ...props.playback.elevenlabs,
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(detail?.message || "Audio could not be loaded.");
    }
    return response.blob();
  };

  const playBlob = async (blob: Blob, run: number) => {
    const audio = audioRef.current;
    if (!audio || run !== runRef.current) return false;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(blob);
    audio.src = objectUrlRef.current;
    audio.load();
    if (!(await waitUntilResumed(run))) return false;

    const ended = new Promise<void>((resolve) => {
      const finish = () => {
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", finish);
        if (finishAudioRef.current === finish) finishAudioRef.current = null;
        resolve();
      };
      finishAudioRef.current = finish;
      audio.addEventListener("ended", finish, { once: true });
      audio.addEventListener("error", finish, { once: true });
    });
    setStatus("playing");
    try {
      await audio.play();
    } catch {
      pausedRef.current = true;
      setStatus("paused");
      setError("Tap Play to allow audio in Brave.");
    }
    await ended;
    return run === runRef.current;
  };

  const playItem = async (item: DrillItem, run: number) => {
    const blob = await fetchAudio(item, run);
    if (!blob || run !== runRef.current) return false;
    for (let repetition = 0; repetition < props.playback.repetitions; repetition += 1) {
      if (!(await playBlob(blob, run))) return false;
      if (repetition < props.playback.repetitions - 1
        && !(await waitForPause(props.playback.pauseMs, run))) return false;
    }
    return waitForPause(props.playback.pauseMs, run);
  };

  const start = async () => {
    if (!props.items.length) return;
    stop();
    props.onBeforeStart();
    const run = runRef.current;
    const queue = [...props.items];
    const loopQueue = queue.filter((item) => props.loopIds.includes(item.publicId));
    setError("");
    try {
      const playQueue = async (items: DrillItem[], looping: boolean) => {
        for (let index = 0; index < items.length; index += 1) {
          if (run !== runRef.current) return false;
          const item = items[index];
          setCurrentId(item.publicId);
          setCurrentLabel(item.target);
          setPosition({ current: index + 1, total: items.length, looping });
          if ("mediaSession" in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: item.target,
              artist: "Rehearsal · Drill",
              album: props.language === "en" ? "English" : "Latvian",
            });
          }
          if (!(await playItem(item, run))) return false;
        }
        return true;
      };
      if (!(await playQueue(queue, false))) return;
      while (loopQueue.length && run === runRef.current) {
        if (!(await playQueue(loopQueue, true))) return;
      }
      if (run === runRef.current) {
        clearAudio();
        setStatus("complete");
        setCurrentId("");
        setCurrentLabel("");
      }
    } catch (caught) {
      if (run !== runRef.current || (caught instanceof DOMException && caught.name === "AbortError")) return;
      clearAudio();
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Drill stopped unexpectedly.");
    }
  };

  const providerAvailable = props.playback.provider === "elevenlabs"
    ? (props.language === "lv" ? props.openaiConfigured : props.elevenLabsConfigured)
    : props.openaiConfigured;
  const active = ["loading", "playing", "paused"].includes(status);

  return <section className={`simple-drill-bar${active ? " is-active" : ""}`} aria-label="Card drill">
    <audio ref={audioRef} preload="auto" playsInline />
    <div className="simple-drill-primary">
      {!active ? <button className="simple-primary" disabled={!props.items.length || !providerAvailable}
        onClick={() => void start()} type="button">
        {status === "complete" ? <RotateCcw size={16} /> : <Play fill="currentColor" size={15} />}
        {status === "complete" ? "Drill again" : "Start drill"}
      </button> : status === "paused" ? <button className="simple-primary" onClick={resume} type="button">
        <Play fill="currentColor" size={15} />Resume
      </button> : <button className="simple-primary" onClick={pause} type="button">
        {status === "loading" ? <LoaderCircle className="simple-spin" size={16} /> : <Pause fill="currentColor" size={15} />}
        {status === "loading" ? "Loading" : "Pause"}
      </button>}
      <div className="simple-drill-now">
        {active ? <><strong>{position.looping ? "Loop" : `${position.current} / ${position.total}`}</strong><span>{currentLabel || "Loading the next card…"}</span></>
          : <><strong>{props.items.length} cards</strong><span>Top to bottom{props.loopIds.length ? `, then ${props.loopIds.length} on loop` : ""}.</span></>}
      </div>
    </div>
    <div className="simple-drill-actions">
      {active ? <button aria-label="Stop drill" onClick={stop} title="Stop drill" type="button"><Square fill="currentColor" size={13} /><span>Stop</span></button> : null}
      <button aria-pressed={props.arranging} disabled={active} onClick={props.onArrange} type="button"><ListMusic size={16} /><span>Order</span></button>
      <button aria-label="Playback settings" disabled={active} onClick={props.onSettings} title="Playback settings" type="button"><Settings2 size={16} /></button>
    </div>
    {error ? <p className="simple-drill-error" role="status">{error}</p> : null}
  </section>;
}
