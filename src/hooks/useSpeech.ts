import { useCallback, useEffect, useRef, useState } from "react";

type SpeakOptions = {
  locale: string;
  rate: number;
  repetitions?: number;
  pauseMs?: number;
  onComplete?: () => void;
};

export type SpeechPart = {
  text: string;
  locale: string;
  rate: number;
  pauseAfterMs?: number;
};

const wait = (duration: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, duration));

export const useSpeech = () => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const sequenceRef = useRef(0);

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
  }, []);

  const stop = useCallback(() => {
    sequenceRef.current += 1;
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const speakOnce = useCallback(
    (text: string, locale: string, rate: number) =>
      new Promise<void>((resolve) => {
        if (!("speechSynthesis" in window)) {
          resolve();
          return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = locale;
        utterance.rate = rate;
        utterance.voice =
          voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase()) ??
          voices.find((voice) => voice.lang.toLowerCase().startsWith(locale.slice(0, 2))) ??
          null;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      }),
    [voices],
  );

  const speakSequence = useCallback(
    async (
      parts: SpeechPart[],
      options: Pick<SpeakOptions, "repetitions" | "pauseMs" | "onComplete"> = {},
    ) => {
      stop();
      const sequence = sequenceRef.current;
      setIsSpeaking(true);
      const repetitions = options.repetitions ?? 1;

      for (let index = 0; index < repetitions; index += 1) {
        for (const part of parts) {
          if (sequence !== sequenceRef.current) return;
          await speakOnce(part.text, part.locale, part.rate);
          if (part.pauseAfterMs) await wait(part.pauseAfterMs);
        }
        if (index < repetitions - 1 && options.pauseMs) {
          await wait(options.pauseMs);
        }
      }

      if (sequence !== sequenceRef.current) return;
      setIsSpeaking(false);
      options.onComplete?.();
    },
    [speakOnce, stop],
  );

  const speak = useCallback(
    (text: string, options: SpeakOptions) =>
      speakSequence(
        [{ text, locale: options.locale, rate: options.rate }],
        options,
      ),
    [speakSequence],
  );

  useEffect(() => stop, [stop]);

  return { isSpeaking, speak, speakSequence, stop };
};
