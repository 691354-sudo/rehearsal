import {
  guidedPracticeExercises,
  guidedPracticeStartMessage,
} from "../../../contracts/tutor-guided-practice";

export function TutorGuidedPracticeStart({ disabled, onStart }: {
  disabled: boolean;
  onStart: (message: string) => void;
}) {
  return <div className="simple-chat-empty">
    <strong>Choose an exercise</strong>
    <span>Pick one below, or let Tutor choose what will help most today.</span>
    <div className="simple-chat-auto-start">
      <button className="simple-chat-start-primary" disabled={disabled}
        onClick={() => onStart(guidedPracticeStartMessage)} type="button">Start for me</button>
      <span>Tutor checks what is due and chooses the next exercise.</span>
    </div>
    <div aria-label="Tutor exercises" className="simple-chat-exercise-grid" role="group">
      {guidedPracticeExercises.map((exercise) => <button className="simple-chat-exercise-card"
        disabled={disabled} key={exercise.id} onClick={() => onStart(exercise.message)} type="button">
        <strong>{exercise.title}</strong><span>{exercise.description}</span>
      </button>)}
    </div>
  </div>;
}
