const WITH_RATINGS_DEFAULT_LIMIT = 20000;
const WITH_RATINGS_MAX_LIMIT = 40000;

function clampLimit(
  requested: unknown,
  defaultLimit: number,
  maxLimit: number,
): number {
  const requestedNumber =
    typeof requested === "number" || typeof requested === "string"
      ? Number(requested)
      : Number.NaN;

  if (!Number.isFinite(requestedNumber) || requestedNumber <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.floor(requestedNumber), maxLimit);
}

export { WITH_RATINGS_DEFAULT_LIMIT, WITH_RATINGS_MAX_LIMIT, clampLimit };
