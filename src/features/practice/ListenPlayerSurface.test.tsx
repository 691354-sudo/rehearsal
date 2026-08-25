import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultPlayback } from "../../shared/config";
import type { LearningItem } from "../../shared/contracts";
import { ListenPlayerSurface } from "./ListenPlayerSurface";

const item = {
  publicId: "card-1",
  language: "en",
  kind: "phrase",
  target: "I wish I could turn things around.",
  cue: "Жаль, что я не могу всё изменить.",
  acceptedAnswers: [],
  note: "",
  source: "test",
  status: "new",
  preference: "neutral",
  naturalness: 1,
  commonness: 1,
  register: "neutral",
  tags: [],
  focusTerms: [],
  frequencyBand: "core",
  currency: "current",
  personaFit: 1,
  relevanceCheckedAt: null,
  practiceEnabled: true,
  progress: { stage: "new", recalls: 0, listens: 0 },
} satisfies LearningItem;

describe("Listen player surface", () => {
  it("keeps Edit compact beside the repeat prompt and exposes a non-editable focus target", () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(<ListenPlayerSurface current={item} editActive={false} error="" index={0} language="en" note=""
      onEdit={noop} onNext={noop} onPause={noop} onPrevious={noop} onReplay={noop} onResume={noop}
      onRetryPreparation={noop} onShuffle={noop} onToggleRepeat={noop} onToggleRussian={noop} onToggleSettings={noop}
      playback={defaultPlayback} playbackSettings={null} preparationError="" preparationTotal={1} previousDisabled
      queueLength={1} readyCount={1} repeatMode="off" selectedTopicName="Personal stories" selectedVoiceName="Justin Time"
      showPlaybackSettings={false} showRussian={false} status="playing" />);

    const promptRowStart = markup.indexOf("listen-prompt-row");
    const promptRow = markup.slice(promptRowStart, markup.indexOf("</div>", promptRowStart));
    expect(markup).toContain('tabindex="-1"');
    expect(promptRow).toContain("Repeat after the speaker");
    expect(promptRow).toContain("practice-active-edit");
  });
});
