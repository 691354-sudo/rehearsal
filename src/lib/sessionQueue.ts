export type ReviewRating = "again" | "hard" | "good" | "easy";

export const reviewRatings: ReviewRating[] = ["again", "hard", "good", "easy"];

export const moveReviewRating = (
  current: ReviewRating,
  direction: -1 | 1,
): ReviewRating => {
  const currentIndex = reviewRatings.indexOf(current);
  const nextIndex = Math.min(reviewRatings.length - 1, Math.max(0, currentIndex + direction));
  return reviewRatings[nextIndex];
};

export const ratingFromVerdict = (
  verdict: "exact" | "close" | "retry",
): ReviewRating => {
  if (verdict === "retry") return "again";
  if (verdict === "close") return "hard";
  return "good";
};

export const moveReviewedItem = <T>(
  items: T[],
  rating: ReviewRating,
  reviewedIndex = 0,
): T[] => {
  if (items.length < 2) return items;

  const reviewed = items[reviewedIndex];
  if (reviewed === undefined) return items;
  const remaining = items.filter((_, index) => index !== reviewedIndex);
  const insertAt =
    rating === "again"
      ? Math.min(1, remaining.length)
      : rating === "hard"
        ? Math.min(2, remaining.length)
        : remaining.length;

  return [
    ...remaining.slice(0, insertAt),
    reviewed,
    ...remaining.slice(insertAt),
  ];
};
