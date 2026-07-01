export const ARTICLES_WITH_RATINGS_DEFAULT_PAGE_SIZE = 200;
export const ARTICLES_WITH_RATINGS_MAX_PAGE_SIZE = 500;

export const ARTICLES_DEFAULT_PAGE_SIZE = 200;
export const ARTICLES_MAX_PAGE_SIZE = 500;

export const APPROVED_ARTICLES_DEFAULT_PAGE_SIZE = 50;
export const APPROVED_ARTICLES_MAX_PAGE_SIZE = 200;

export type ArticleCursorParseResult =
  | {
      isValid: true;
      cursor: number | undefined;
    }
  | {
      isValid: false;
      cursor: undefined;
      reason: string;
    };

export const clampPageSize = (
  requested: unknown,
  defaultSize: number,
  maxSize: number,
): number => {
  if (requested === undefined || requested === null || requested === "") {
    return defaultSize;
  }

  const requestedNumber =
    typeof requested === "number"
      ? requested
      : typeof requested === "string"
        ? Number(requested)
        : Number.NaN;

  if (
    !Number.isSafeInteger(requestedNumber) ||
    requestedNumber <= 0
  ) {
    return defaultSize;
  }

  return Math.min(requestedNumber, maxSize);
};

export const parseArticleCursor = (
  requested: unknown,
): ArticleCursorParseResult => {
  if (requested === undefined) {
    return {
      isValid: true,
      cursor: undefined,
    };
  }

  if (typeof requested === "number") {
    if (Number.isSafeInteger(requested) && requested > 0) {
      return {
        isValid: true,
        cursor: requested,
      };
    }

    return {
      isValid: false,
      cursor: undefined,
      reason: "cursor must be a positive safe integer article id",
    };
  }

  if (typeof requested === "string" && /^[1-9]\d*$/.test(requested.trim())) {
    const cursor = Number(requested.trim());

    if (Number.isSafeInteger(cursor)) {
      return {
        isValid: true,
        cursor,
      };
    }
  }

  return {
    isValid: false,
    cursor: undefined,
    reason: "cursor must be a positive safe integer article id",
  };
};
