import { calculateOldArticleCutoffDate } from "../../src/modules/deleteArticlesCutoff";

describe("calculateOldArticleCutoffDate()", () => {
  it("subtracts days using local calendar arithmetic and returns a UTC date", () => {
    const now = new Date(2026, 9, 2, 12, 0, 0);

    expect(calculateOldArticleCutoffDate(180, now)).toBe("2026-04-05");
  });

  it("does not mutate the supplied date", () => {
    const now = new Date(2026, 0, 15, 8, 30, 0);
    const originalTimestamp = now.getTime();

    calculateOldArticleCutoffDate(30, now);

    expect(now.getTime()).toBe(originalTimestamp);
  });
});
