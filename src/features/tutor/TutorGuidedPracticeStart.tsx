import {
  guidedPracticeMenuMessage,
  guidedPracticeStartMessage,
} from "../../../contracts/tutor-guided-practice";

export function TutorGuidedPracticeStart({ disabled, onStart }: {
  disabled: boolean;
  onStart: (message: string) => void;
}) {
  return <div className="simple-chat-empty">
    <strong>Let Tutor lead</strong>
    <span>Start a short guided practice, or choose how you want to work.</span>
    <div>
      <button className="simple-chat-start-primary" disabled={disabled}
        onClick={() => onStart(guidedPracticeStartMessage)} type="button">Start for me</button>
      <button disabled={disabled} onClick={() => onStart(guidedPracticeMenuMessage)}
        type="button">Choose an exercise</button>
    </div>
  </div>;
}
