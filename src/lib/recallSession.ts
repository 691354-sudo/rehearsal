import { moveReviewRating, type ReviewRating } from "./sessionQueue";

export type RecallSessionState = {
  phase: "setup" | "active" | "complete";
  queue: string[];
  initialTotal: number;
  completed: number;
  selectedRating: ReviewRating;
  saving: boolean;
  error: string;
};

export type RecallSessionAction =
  | { type: "start"; itemIds: string[] }
  | { type: "select-rating"; rating: ReviewRating }
  | { type: "saving" }
  | { type: "save-failed" }
  | { type: "save-succeeded"; rating: ReviewRating }
  | { type: "reset" };

export const initialRecallSession: RecallSessionState = {
  phase: "setup",
  queue: [],
  initialTotal: 0,
  completed: 0,
  selectedRating: "good",
  saving: false,
  error: "",
};

const requeue = (queue: string[], rating: ReviewRating) => {
  const current = queue[0];
  const remaining = queue.slice(1);
  if (!current || rating === "good" || rating === "easy") return remaining;
  const insertAt = rating === "again" ? Math.min(1, remaining.length) : Math.min(3, remaining.length);
  return [...remaining.slice(0, insertAt), current, ...remaining.slice(insertAt)];
};

export const recallSessionReducer = (
  state: RecallSessionState,
  action: RecallSessionAction,
): RecallSessionState => {
  if (action.type === "start") return {
    ...initialRecallSession,
    phase: action.itemIds.length ? "active" : "complete",
    queue: [...action.itemIds],
    initialTotal: action.itemIds.length,
  };
  if (action.type === "reset") return initialRecallSession;
  if (action.type === "select-rating") return { ...state, selectedRating: action.rating, error: "" };
  if (action.type === "saving") return { ...state, saving: true, error: "" };
  if (action.type === "save-failed") return {
    ...state,
    saving: false,
    error: "Couldn’t save. Retry.",
  };
  const queue = requeue(state.queue, action.rating);
  const completed = state.completed + (action.rating === "good" || action.rating === "easy" ? 1 : 0);
  return {
    ...state,
    phase: queue.length ? "active" : "complete",
    queue,
    completed,
    selectedRating: "good",
    saving: false,
    error: "",
  };
};

export const recallKeyAction = (
  key: string,
  checked: boolean,
  rating: ReviewRating,
): "check" | "submit" | ReviewRating | null => {
  if (key === "Enter") return checked ? "submit" : "check";
  if (!checked) return null;
  if (key === "ArrowLeft" || key === "ArrowUp") return moveReviewRating(rating, -1);
  if (key === "ArrowRight" || key === "ArrowDown") return moveReviewRating(rating, 1);
  return null;
};
