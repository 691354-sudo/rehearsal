import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultPlayback } from "../../shared/config";
import { playbackIdentity } from "../audio/listenAudio";
import { RepetitionsButton } from "./RepetitionsButton";

describe("quick repetitions", () => {
  it.each([[1, 2], [2, 1], [3, 1], [5, 1]])("switches %s to %s without changing the voice, speed or audio cache", (repetitions, next) => {
    const playback = { ...defaultPlayback, repetitions, speed: 0.85 };
    const onPlayback = vi.fn();
    const button = RepetitionsButton({ playback, onPlayback });
    button.props.onClick();
    expect(onPlayback).toHaveBeenCalledExactlyOnceWith({ ...playback, repetitions: next });
    expect(playbackIdentity("en", onPlayback.mock.calls[0][0])).toBe(playbackIdentity("en", playback));
    expect(playback.repetitions).toBe(repetitions);
  });

  it("shows a saved count until the learner changes it and announces the next action", () => {
    const onPlayback = vi.fn();
    const markup = renderToStaticMarkup(<RepetitionsButton playback={{ ...defaultPlayback, repetitions: 5 }} onPlayback={onPlayback} />);
    expect(markup).toContain('aria-label="Repetitions: 5. Switch to 1."');
    expect(markup).toContain("5×</button>");
    expect(onPlayback).not.toHaveBeenCalled();
  });
});
