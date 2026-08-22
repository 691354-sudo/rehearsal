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
import { adaptivePauseMs, type PreparedAudio } from "./listenAudio";

type AudioConfig = {
  openai?: { defaultVoice?: string; voices?: string[] };
  elevenlabs?: ElevenLabsConfig;
};

const requiresElevenLabs = (language: Language) => language === "vi" || language === "no";

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
      const strictLanguage = requiresElevenLabs(targetLanguage);
      return {
        provider: strictLanguage ? "elevenlabs" : saved.provider || defaults.provider,
        repetitions: saved.repetitions ?? defaults.repetitions,
        speed: clampPlaybackSpeed(
          strictLanguage || saved.provider === "elevenlabs" ? "elevenlabs" : "openai",
          saved.speed ?? defaults.speed,
          config.speedRange,
        ),
        playAfterRecall: saved.playAfterRecall ?? defaults.playAfterRecall,
        voice: saved.voice || defaults.voice,
        elevenlabs: {
          voiceId: saved.elevenlabs?.voiceId || defaults.elevenlabs.voiceId,
          modelId: strictLanguage ? "eleven_flash_v2_5" : saved.elevenlabs?.modelId || defaults.elevenlabs.modelId,
        },
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
      provider: requiresElevenLabs(language) ? "elevenlabs" : next.provider,
      elevenlabs: {
        ...next.elevenlabs,
        modelId: requiresElevenLabs(language) ? "eleven_flash_v2_5" : next.elevenlabs.modelId,
      },
      speed: clampPlaybackSpeed(requiresElevenLabs(language) ? "elevenlabs" : next.provider, next.speed, elevenLabsConfig.speedRange),
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
      const compatibleVoices = audio.elevenlabs.voicesByLanguage[language] || [];
      setPlayback((current) => {
        if (requiresElevenLabs(language) && languageDefault && !hadSavedPlaybackAtMountRef.current) {
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
        return compatibleVoices.some((voice) => voice.id === current.elevenlabs.voiceId)
          ? current : {
              ...current,
              elevenlabs: {
                ...current.elevenlabs,
                voiceId: languageDefault?.voiceId
                  || compatibleVoices[0]?.id || "",
              },
            };
      });
      if (audio.elevenlabs.configured) {
        const statusVoiceId = languageDefault?.voiceId || compatibleVoices[0]?.id || playback.elevenlabs.voiceId;
        if (!statusVoiceId) return;
        void apiFetch(`/api/audio/elevenlabs/status?voiceId=${encodeURIComponent(statusVoiceId)}`).then(async (response) => {
          if (!response.ok) return;
          const status = await response.json() as ElevenLabsVoiceStatus;
          if (status.reachable) setElevenLabsConfig((current) => ({
            ...current,
            voice: { id: status.voice.id, name: status.voice.name },
            voicesByLanguage: {
              ...current.voicesByLanguage,
              [language]: (current.voicesByLanguage[language] || []).map((voice) => voice.id === status.voice.id
                ? { id: status.voice.id, name: status.voice.name } : voice),
            },
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

  const resolvePlayback = (overrides: Partial<PlaybackPreferences>) => ({
    ...playback,
    ...overrides,
    elevenlabs: { ...playback.elevenlabs, ...overrides.elevenlabs },
  });

  const fetchTargetAudio = async (
    text: string,
    overrides: Partial<PlaybackPreferences> = {},
    strictProvider = true,
  ): Promise<PreparedAudio> => {
    const nextPlayback = resolvePlayback(overrides);
    const request = async (provider: "openai" | "elevenlabs") => {
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
      const cacheHeader = response.headers.get("X-Audio-Cache");
      return {
        blob: await response.blob(),
        cache: cacheHeader === "HIT" || cacheHeader === "MISS" ? cacheHeader : null,
        provider,
      } satisfies PreparedAudio;
    };
    const provider = requiresElevenLabs(language) ? "elevenlabs" : nextPlayback.provider;
    try {
      return await request(provider);
    } catch (error) {
      if (!strictProvider && !requiresElevenLabs(language) && provider === "elevenlabs") {
        return request("openai");
      }
      const message = error instanceof Error ? error.message : "Audio is unavailable.";
      setPlaybackError(message);
      throw error;
    }
  };

  const playPreparedAudio = async (url: string, repetitions = 1) => {
    stopPlayback();
    const sequence = audioSequenceRef.current;
    const audio = audioElementRef.current || new Audio();
    audio.preload = "auto";
    audioElementRef.current = audio;
    audio.src = url;
    let durationMs = 0;
    try {
      for (let repetition = 0; repetition < repetitions; repetition += 1) {
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
        durationMs = Number.isFinite(audio.duration) ? audio.duration * 1_000 : durationMs;
        if (repetition < repetitions - 1 && sequence === audioSequenceRef.current) {
          await waitForAudioPause(adaptivePauseMs(durationMs), sequence);
        }
      }
    } finally {
      if (sequence === audioSequenceRef.current) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
    }
    return durationMs;
  };

  const waitForAudioPause = (pauseMs: number, sequence: number) => new Promise<void>((resolve) => {
    let remaining = pauseMs;
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
      if (!running || sequence !== audioSequenceRef.current) return;
      running = false;
      window.clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    audioResumeRef.current = () => {
      if (running || settled || sequence !== audioSequenceRef.current) return;
      running = true;
      startedAt = Date.now();
      timer = window.setTimeout(finish, remaining);
    };
  });

  const playTarget = async (
    text: string,
    overrides: Partial<PlaybackPreferences> = {},
    strictProvider = false,
  ) => {
    lastPlaybackRef.current = { text, overrides, strictProvider };
    setPlaybackError("");
    const nextPlayback = resolvePlayback(overrides);
    if (openaiConfigured || elevenLabsConfig.configured) {
      try {
        const prepared = await fetchTargetAudio(text, overrides, strictProvider);
        const url = URL.createObjectURL(prepared.blob);
        try {
          await playPreparedAudio(url, nextPlayback.repetitions);
        } finally {
          URL.revokeObjectURL(url);
        }
        return { provider: prepared.provider, cache: prepared.cache } satisfies PlaybackResult;
      } catch (error) {
        if (strictProvider || requiresElevenLabs(language)) throw error;
        setPlaybackError("");
      }
    }
    if (requiresElevenLabs(language)) {
      const error = new Error(`${language === "vi" ? "Vietnamese" : "Norwegian"} audio requires a compatible ElevenLabs voice.`);
      setPlaybackError(error.message);
      throw error;
    }
    audioPauseRef.current = () => window.speechSynthesis?.pause();
    audioResumeRef.current = () => window.speechSynthesis?.resume();
    await speak(text, {
      locale: languageCopy[language].locale,
      rate: nextPlayback.speed,
      repetitions: nextPlayback.repetitions,
      pauseMs: adaptivePauseMs(Math.max(1_000, text.trim().split(/\s+/).length * 350 / nextPlayback.speed)),
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
    fetchTargetAudio,
    playPreparedAudio,
    playTarget,
    retryPlayback,
    dismissPlaybackError: () => setPlaybackError(""),
    resumePlayback,
    stopPlayback,
    updatePlayback,
    voices,
  };
};
