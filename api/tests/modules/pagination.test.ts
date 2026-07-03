import {
  WITH_RATINGS_DEFAULT_LIMIT,
  WITH_RATINGS_MAX_LIMIT,
  clampLimit,
} from "../../src/modules/pagination";

describe("pagination helpers", () => {
  test.each([undefined, null, "abc", Number.NaN, 0, -1])(
    "clampLimit returns default for invalid value %p",
    (value) => {
      expect(
        clampLimit(
          value,
          WITH_RATINGS_DEFAULT_LIMIT,
          WITH_RATINGS_MAX_LIMIT,
        ),
      ).toBe(WITH_RATINGS_DEFAULT_LIMIT);
    },
  );

  test("clampLimit floors valid values and caps at max", () => {
    expect(
      clampLimit(1000, WITH_RATINGS_DEFAULT_LIMIT, WITH_RATINGS_MAX_LIMIT),
    ).toBe(1000);
    expect(
      clampLimit("2500", WITH_RATINGS_DEFAULT_LIMIT, WITH_RATINGS_MAX_LIMIT),
    ).toBe(2500);
    expect(
      clampLimit(2500.9, WITH_RATINGS_DEFAULT_LIMIT, WITH_RATINGS_MAX_LIMIT),
    ).toBe(2500);
    expect(
      clampLimit(
        50000,
        WITH_RATINGS_DEFAULT_LIMIT,
        WITH_RATINGS_MAX_LIMIT,
      ),
    ).toBe(WITH_RATINGS_MAX_LIMIT);
  });
});
