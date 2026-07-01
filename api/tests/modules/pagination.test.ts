import {
  ARTICLES_DEFAULT_PAGE_SIZE,
  ARTICLES_MAX_PAGE_SIZE,
  APPROVED_ARTICLES_DEFAULT_PAGE_SIZE,
  APPROVED_ARTICLES_MAX_PAGE_SIZE,
  ARTICLES_WITH_RATINGS_DEFAULT_PAGE_SIZE,
  ARTICLES_WITH_RATINGS_MAX_PAGE_SIZE,
  clampPageSize,
  parseArticleCursor,
} from "../../src/modules/pagination";

describe("pagination module", () => {
  describe("page-size constants", () => {
    test("exports the planned endpoint defaults and maximums", () => {
      expect(ARTICLES_WITH_RATINGS_DEFAULT_PAGE_SIZE).toBe(200);
      expect(ARTICLES_WITH_RATINGS_MAX_PAGE_SIZE).toBe(500);
      expect(ARTICLES_DEFAULT_PAGE_SIZE).toBe(200);
      expect(ARTICLES_MAX_PAGE_SIZE).toBe(500);
      expect(APPROVED_ARTICLES_DEFAULT_PAGE_SIZE).toBe(50);
      expect(APPROVED_ARTICLES_MAX_PAGE_SIZE).toBe(200);
    });
  });

  describe("clampPageSize", () => {
    test.each([
      [undefined, 200],
      [null, 200],
      ["", 200],
      [25, 25],
      ["25", 25],
      [750, 500],
      ["750", 500],
      [0, 200],
      [-1, 200],
      ["not-a-number", 200],
      [1.5, 200],
      ["1.5", 200],
      [Number.MAX_SAFE_INTEGER + 1, 200],
      [true, 200],
    ])("returns %i for requested page size %p", (requested, expected) => {
      expect(clampPageSize(requested, 200, 500)).toBe(expected);
    });
  });

  describe("parseArticleCursor", () => {
    test.each([
      [undefined, { isValid: true, cursor: undefined }],
      [123, { isValid: true, cursor: 123 }],
      ["123", { isValid: true, cursor: 123 }],
      [" 123 ", { isValid: true, cursor: 123 }],
    ])("accepts cursor input %p", (requested, expected) => {
      expect(parseArticleCursor(requested)).toEqual(expected);
    });

    test.each([
      null,
      "",
      0,
      -1,
      "0",
      "-1",
      "not-a-number",
      1.5,
      "1.5",
      "1e3",
      Number.MAX_SAFE_INTEGER + 1,
      String(Number.MAX_SAFE_INTEGER + 1),
      true,
    ])("rejects unsafe or invalid cursor input %p", (requested) => {
      expect(parseArticleCursor(requested)).toEqual({
        isValid: false,
        cursor: undefined,
        reason: "cursor must be a positive safe integer article id",
      });
    });
  });
});
