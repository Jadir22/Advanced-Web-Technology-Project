
export const DEFAULT_MIN_MATCH_SCORE = 1;

export function getMinimumMatchScore(
  value: string | undefined = process.env.MATCH_MIN_SCORE,
): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_MIN_MATCH_SCORE;
  }

  const threshold = Number(value);

  if (
    !Number.isFinite(threshold) ||
    threshold < 1 ||
    threshold > 100
  ) {
    throw new Error(
      "MATCH_MIN_SCORE must be between 1 and 100",
    );
  }

  return threshold;
}

export function isEligibleMatchScore(
  score: number,
  minimumScore: number = getMinimumMatchScore(),
): boolean {
  return (
    Number.isFinite(score) &&
    score >= 0 &&
    score <= 100 &&
    score >= minimumScore
  );
}
