import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileId } from "../../../contracts/api";
import { useSpeech } from "../../hooks/useSpeech";
import { clampPlaybackSpeed } from "../../lib/playbackSettings";
import { apiFetch } from "../../shared/api";
import {
  defaultElevenLabsConfig,
  defaultPlayback,
  defaultVoices,
  languageCopy,
} from "../../shared/config";
import type {
  ElevenLabsConfig,
  ElevenLabsVoiceStatus,
  Language,
  PlaybackPreferences,
  PlaybackResult,
} from "../../shared/contracts";

type AudioConfig = {
  openai?: { defaultVoice?: string; voices?: string[] };
  elevenlabs?: ElevenLabsConfig;
};

export const usePlaybackController = (profileId: ProfileId, language: Language) => {
  const storageKey = `rehearsal:${profileId}:playback`;
  const [playback, setPlayback] = useState<PlaybackPreferences>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<PlaybackPreferences>;
      return {
        ...defaultPlayback,
        ...saved,
        elevenlabs: { ...defaultPlayback.elevenlabs, ...saved.elevenlabs },
        speed: clampPlaybackSpeed(saved.provider === "elevenlabs" ? "elevenlabs" : "openai", saved.speed ?? 1),
      };
    } catch { return defaultPlayback; }
  });
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [voices, setVoices] = useState(defaultVoices);
  const [elevenLabsConfig, setElevenLabsConfig] = useState(defaultElevenLabsConfig);
  const { speak, stop } = useSpeech();
  const audioSequenceRef = useRef(0);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioCancelRef = useRef<(() => void) | null>(null);
  const audioPauseRef = useRef<(() => void) | null>(null);
  const audioResumeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(playback));
  }, [playback, storageKey]);

  useEffect(() => {
    const speed = clampPlaybackSpeed(playback.provider, playback.speed, elevenLabsConfig.speedRange);
    if (speed !== playback.speed) setPlayback((current) => ({ ...current, speed }));
  }, [elevenLabsConfig.speedRange, playback.provider, playback.speed]);

  const updatePlayback = useCallback((next: PlaybackPreferences) => {
    setPlayback({
      ...next,
      speed: clampPlaybackSpeed(next.provider, next.speed, elevenLabsConfig.speedRange),
    });
  }, [elevenLabsConfig.speedRange]);

  const applyAudioConfig = useCallback((configured: boolean, audio?: AudioConfig) => {
    setOpenaiConfigured(configured);
    if (audio?.openai?.voices?.length) {
      const openAiVoices = audio.openai.voices;
      const defaultVoice = openAiVoices.includes(audio.openai.defaultVoice || "")
        ? audio.openai.defaultVoice as string : openAiVoices[0];
      setVoices(openAiVoices);
      setPlayback((current) => openAiVoices.includes(current.voice) ? current : { ...current, voice: defaultVoice });
    }
    if (audio?.elevenlabs) {
      setElevenLabsConfig(audio.elevenlabs);
      setPlayback((current) => audio.elevenlabs?.voices.some(
        (voice) => voice.id === current.elevenlabs.voiceId,
      ) ? current : {
        ...current,
        elevenlabs: { ...current.elevenlabs, voiceId: audio.elevenlabs?.voice.id || current.elevenlabs.voiceId },
      });
      if (audio.elevenlabs.configured) {
        void apiFetch("/api/audio/elevenlabs/status").then(async (response) => {
          if (!response.ok) return;
          const status = await response.json() as ElevenLabsVoiceStatus;
          if (status.reachable) setElevenLabsConfig((current) => ({
            ...current,
            voice: { id: status.voice.id, name: status.voice.name },
            voices: current.voices.map((voice) => voice.id === status.voice.id
              ? { id: status.voice.id, name: status.voice.name } : voice),
          }));
        }).catch(() => { /* Settings exposes provider retry without blocking the app. */ });
      }
    }
  }, []);

  const stopPlayback = useCallback(() => {
    audioSequenceRef.current += 1;
    audioCancelRef.current?.();
    audioCancelRef.current = null;
    audioPauseRef.current = null;
    audioResumeRef.current = null;
    const audio = audioElementRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    stop();
  }, [stop]);

  useEffect(() => {
    stopPlayback();
  }, [language, profileId, stopPlayback]);

  useEffect(() => () => {
    stopPlayback();
    audioElementRef.current = null;
  }, [stopPlayback]);

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
      if (sequence !== audioSequenceRef.current) {
        URL.revokeObjectURL(url);
        return cache;
      }
      const audio = audioElementRef.current || new Audio();
      audio.preload = "auto";
      audioElementRef.current = audio;
      audio.src = url;
      try {
        for (let repetition = 0; repetition < nextPlayback.repetitions; repetition += 1) {
          if (sequence !== audioSequenceRef.current) break;
          audio.currentTime = 0;
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              audio.removeEventListener("ended", finish);
              audio.removeEventListener("error", finish);
              if (audioCancelRef.current === cancel) {
                audioCancelRef.current = null;
                audioPauseRef.current = null;
                audioResumeRef.current = null;
              }
              resolve();
            };
            const cancel = finish;
            audioCancelRef.current = cancel;
            audioPauseRef.current = () => audio.pause();
            audioResumeRef.current = () => { void audio.play().catch(finish); };
            audio.addEventListener("ended", finish, { once: true });
            audio.addEventListener("error", finish, { once: true });
            void audio.play().catch(finish);
          });
          if (repetition < nextPlayback.repetitions - 1 && sequence === audioSequenceRef.current) {
            await new Promise<void>((resolve) => {
              let remaining = nextPlayback.pauseMs;
              let startedAt = Date.now();
              let timer = window.setTimeout(finish, remaining);
              let running = true;
              let settled = false;
              function finish() {
                if (settled) return;
                settled = true;
                running = false;
                window.clearTimeout(timer);
                if (audioCancelRef.current === cancel) {
                  audioCancelRef.current = null;
                  audioPauseRef.current = null;
                  audioResumeRef.current = null;
                }
                resolve();
              }
              const cancel = finish;
              audioCancelRef.current = cancel;
              audioPauseRef.current = () => {
                if (!running) return;
                running = false;
                window.clearTimeout(timer);
                remaining = Math.max(0, remaining - (Date.now() - startedAt));
              };
              audioResumeRef.current = () => {
                if (running || settled) return;
                running = true;
                startedAt = Date.now();
                timer = window.setTimeout(finish, remaining);
              };
            });
          }
        }
      } finally {
        if (sequence === audioSequenceRef.current) {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        URL.revokeObjectURL(url);
      }
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
            ...nextPlayback.elevenlabs,
          }),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(error?.message || "TTS unavailable");
        }
        return { provider, cache: await playAudioResponse(response) } satisfies PlaybackResult;
      } catch (error) {
        if (strictProvider) throw error;
        if (nextPlayback.provider === "elevenlabs") {
          try {
            const response = await apiFetch("/api/audio/speech", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, language, provider: "openai", speed: nextPlayback.speed, voice: nextPlayback.voice }),
            });
            if (response.ok) return { provider: "openai", cache: await playAudioResponse(response) } satisfies PlaybackResult;
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

  return {
    applyAudioConfig,
    elevenLabsConfig,
    pausePlayback,
    playback,
    playTarget,
    resumePlayback,
    stopPlayback,
    updatePlayback,
    voices,
  };
};
