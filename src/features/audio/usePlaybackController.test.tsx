import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "./usePlaybackController";

const mocks = vi.hoisted(() => ({ request: vi.fn(), speak: vi.fn(), stop: vi.fn() }));
vi.mock("../../shared/api", () => ({ apiFetch: mocks.request }));
vi.mock("./useAccountPlayback", () => ({ useAccountPlayback: () => vi.fn() }));
vi.mock("../../hooks/useSpeech", () => ({ useSpeech: () => ({ speak: mocks.speak, stop: mocks.stop }) }));
vi.mock("../../shared/config", async (original) => {
  const config = await original<typeof import("../../shared/config")>();
  return { ...config, defaultElevenLabsConfig: { ...config.defaultElevenLabsConfig, configured: true } };
});

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = ""; src = ""; currentTime = 0; duration = 0.01;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn();
  constructor() { super(); FakeAudio.instances.push(this); }
}

const response = () => new Response(new Blob(["audio"]), { headers: { "X-Audio-Cache": "HIT" } });
function controller() {
  let audio!: ReturnType<typeof usePlaybackController>;
  function Harness() { audio = usePlaybackController("roman", "en"); return null; }
  renderToStaticMarkup(<Harness />);
  return audio;
}

describe("speech request cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); FakeAudio.instances = [];
    vi.stubGlobal("window", { localStorage: { getItem: () => null }, setTimeout, clearTimeout });
    vi.stubGlobal("Audio", FakeAudio);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:audio");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("does not play a card whose audio arrives after Stop", async () => {
    const pending = Promise.withResolvers<Response>(); mocks.request.mockReturnValue(pending.promise);
    const audio = controller();
    const playing = audio.playTarget("Previous card", { repetitions: 2 });
    audio.stopPlayback(); pending.resolve(response()); await playing;
    expect(FakeAudio.instances).toHaveLength(0);
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("does not fall back to browser speech when a stopped request fails", async () => {
    const pending = Promise.withResolvers<Response>(); mocks.request.mockReturnValue(pending.promise);
    const audio = controller();
    const playing = audio.playTarget("Previous card");
    audio.stopPlayback(); pending.reject(new Error("Network error")); await playing;
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("keeps the newer card playing when an older request finishes later", async () => {
    const pending = Promise.withResolvers<Response>();
    mocks.request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response());
    const audio = controller();
    const previous = audio.playTarget("Previous card");
    const current = audio.playTarget("Current card", { repetitions: 1 });
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    const active = FakeAudio.instances[0]; const pauses = active.pause.mock.calls.length;
    pending.resolve(response()); await previous;
    expect(FakeAudio.instances).toHaveLength(1);
    expect(active.pause).toHaveBeenCalledTimes(pauses);
    active.dispatchEvent(new Event("ended")); await current;
  });

  it.each([false, true])("cancels remaining repeats when stopped during the pause: %s", async (duringPause) => {
    mocks.request.mockResolvedValue(response()); const audio = controller();
    const playing = audio.playTarget("Previous card", { repetitions: 2 });
    await vi.waitFor(() => expect(FakeAudio.instances[0]?.play).toHaveBeenCalledOnce());
    const active = FakeAudio.instances[0];
    if (duringPause) { active.dispatchEvent(new Event("ended")); await Promise.resolve(); }
    audio.stopPlayback(); await vi.runAllTimersAsync(); await playing;
    expect(active.play).toHaveBeenCalledOnce(); expect(active.pause).toHaveBeenCalled();
  });
});
