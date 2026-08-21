import { useCallback, useEffect, useRef, useState } from "react";
import type { ProfileId } from "../../../contracts/api";
import { useSpeech } from "../../hooks/useSpeech";
import { clampPlaybackSpeed, playbackStorageKey, storedPlaybackValue } from "../../lib/playbackSettings";
import { apiFetch } from "../../shared/api";
import {
  defaultElevenLabsConfig,
  defaultPlaybackForLanguage,
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
  const storageKey = playbackStorageKey(profileId, language);
  const hadSavedPlaybackAtMountRef = useRef(Boolean(
    storedPlaybackValue(window.localStorage, profileId, language),
  ));
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [voices, setVoices] = useState(defaultVoices);
  const [elevenLabsConfig, setElevenLabsConfig] = useState(defaultElevenLabsConfig);
  const readPlayback = (targetLanguage: Language, config: ElevenLabsConfig) => {
    try {
      const saved = JSON.parse(
        storedPlaybackValue(window.localStorage, profileId, targetLanguage) || "{}",
      ) as Partial<PlaybackPreferences>;
      const defaults = defaultPlaybackForLanguage(targetLanguage, config);
      return {
        ...defaults,
        ...saved,
        provider: targetLanguage === "vi" ? "elevenlabs" : saved.provider || defaults.provider,
        elevenlabs: {
          ...defaults.elevenlabs,
          ...saved.elevenlabs,
          modelId: targetLanguage === "vi" ? "eleven_flash_v2_5" : saved.elevenlabs?.modelId || defaults.elevenlabs.modelId,
        },
        speed: clampPlaybackSpeed(
          targetLanguage === "vi" || saved.provider === "elevenlabs" ? "elevenlabs" : "openai",
          saved.speed ?? defaults.speed,
          config.speedRange,
        ),
      };
    } catch { return defaultPlaybackForLanguage(targetLanguage, config); }
  };
  const [playbackByLanguage, setPlaybackByLanguage] = useState<Partial<Record<Language, PlaybackPreferences>>>(() => ({
    [language]: readPlayback(language, defaultElevenLabsConfig),
  }));
  const playback = playbackByLanguage[language] || readPlayback(language, elevenLabsConfig);
  const setPlayback = useCallback((update: PlaybackPreferences | ((current: PlaybackPreferences) => PlaybackPreferences)) => {
    setPlaybackByLanguage((current) => {
      const existing = current[language] || readPlayback(language, elevenLabsConfig);
      const next = typeof update === "function" ? update(existing) : update;
      return { ...current, [language]: next };
    });
  }, [elevenLabsConfig, language, profileId]);
  const [playbackError, setPlaybackError] = useState("");
  const lastPlaybackRef = useRef<{
    text: string;
    overrides: Partial<PlaybackPreferences>;
    strictProvider: boolean;
  } | null>(null);
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
      provider: language === "vi" ? "elevenlabs" : next.provider,
      elevenlabs: {
        ...next.elevenlabs,
        modelId: language === "vi" ? "eleven_flash_v2_5" : next.elevenlabs.modelId,
      },
      speed: clampPlaybackSpeed(language === "vi" ? "elevenlabs" : next.provider, next.speed, elevenLabsConfig.speedRange),
    });
  }, [elevenLabsConfig.speedRange, language, setPlayback]);

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
      const languageDefault = audio.elevenlabs.languageDefaults[language];
      setPlayback((current) => {
        if (language === "vi" && languageDefault && !hadSavedPlaybackAtMountRef.current) {
          return {
            ...current,
            provider: "elevenlabs",
            elevenlabs: {
              ...current.elevenlabs,
              voiceId: languageDefault.voiceId,
              modelId: "eleven_flash_v2_5",
            },
          };
        }
        return audio.elevenlabs?.voices.some((voice) => voice.id === current.elevenlabs.voiceId)
          ? current : {
              ...current,
              elevenlabs: {
                ...current.elevenlabs,
                voiceId: languageDefault?.voiceId
                  || audio.elevenlabs?.voice.id || current.elevenlabs.voiceId,
              },
            };
      });
      if (audio.elevenlabs.configured) {
        const statusVoiceId = languageDefault?.voiceId || playback.elevenlabs.voiceId;
        void apiFetch(`/api/audio/elevenlabs/status?voiceId=${encodeURIComponent(statusVoiceId)}`).then(async (response) => {
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
  }, [language, playback.elevenlabs.voiceId, setPlayback]);

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
    setPlaybackError("");
    lastPlaybackRef.current = null;
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
    lastPlaybackRef.current = { text, overrides, strictProvider };
    setPlaybackError("");
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
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              audio.removeEventListener("ended", onEnded);
              audio.removeEventListener("error", onError);
              if (audioCancelRef.current === cancel) {
                audioCancelRef.current = null;
                audioPauseRef.current = null;
                audioResumeRef.current = null;
              }
              if (error) reject(error); else resolve();
            };
            const cancel = () => finish();
            const onEnded = () => finish();
            const onError = () => finish(new Error("Audio playback failed."));
            audioCancelRef.current = cancel;
            audioPauseRef.current = () => audio.pause();
            audioResumeRef.current = () => { void audio.play().catch(() => finish(new Error("Audio playback failed."))); };
            audio.addEventListener("ended", onEnded, { once: true });
            audio.addEventListener("error", onError, { once: true });
            void audio.play().catch(() => finish(new Error("Audio playback failed.")));
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
        const provider = language === "vi" ? "elevenlabs"
          : !strictProvider && language === "lv" && nextPlayback.provider === "elevenlabs"
          ? "openai" : nextPlayback.provider;
        const response = await apiFetch("/api/audio/speech", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            language,
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
        if (strictProvider || language === "vi") {
          const message = error instanceof Error ? error.message : "Vietnamese audio is unavailable.";
          setPlaybackError(message);
          throw error;
        }
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
    if (language === "vi") {
      const error = new Error("Vietnamese audio requires the configured ElevenLabs voice.");
      setPlaybackError(error.message);
      throw error;
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

  const retryPlayback = async () => {
    const last = lastPlaybackRef.current;
    if (!last) throw new Error("Nothing to retry");
    return playTarget(last.text, last.overrides, last.strictProvider);
  };

  return {
    applyAudioConfig,
    elevenLabsConfig,
    pausePlayback,
    playback,
    playbackError,
    playTarget,
    retryPlayback,
    dismissPlaybackError: () => setPlaybackError(""),
    resumePlayback,
    stopPlayback,
    updatePlayback,
    voices,
  };
};
