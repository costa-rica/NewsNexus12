const mockQuery = jest.fn();

jest.mock("@newsnexus/db-models", () => ({
  sequelize: {
    query: mockQuery,
  },
}));

import {
  buildWithRatingsWhereClause,
  sqlQueryArticlesAndAiScores,
} from "../../src/modules/queriesSql";

describe("with-ratings SQL helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("buildWithRatingsWhereClause returns no WHERE for empty filters", () => {
    const result = buildWithRatingsWhereClause({});

    expect(result).toEqual({
      clause: "",
      replacements: {},
    });
  });

  test("buildWithRatingsWhereClause emits created-at date predicate", () => {
    const result = buildWithRatingsWhereClause({
      returnOnlyThisCreatedAtDateOrAfter: "2026-07-01",
    });

    expect(result.clause).toBe(
      'WHERE a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter',
    );
    expect(result.replacements).toEqual({
      returnOnlyThisCreatedAtDateOrAfter: "2026-07-01",
    });
  });

  test("buildWithRatingsWhereClause emits published-date predicate", () => {
    const result = buildWithRatingsWhereClause({
      returnOnlyThisPublishedDateOrAfter: "2026-06-01",
    });

    expect(result.clause).toBe(
      'WHERE a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter',
    );
    expect(result.replacements).toEqual({
      returnOnlyThisPublishedDateOrAfter: "2026-06-01",
    });
  });

  test("buildWithRatingsWhereClause emits not-approved predicate", () => {
    const result = buildWithRatingsWhereClause({
      returnOnlyIsNotApproved: true,
    });

    expect(result.clause).toContain(
      'NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa',
    );
    expect(result.clause).toContain('aa."isApproved" = true');
    expect(result.replacements).toEqual({});
  });

  test("buildWithRatingsWhereClause emits with-ratings relevance predicate", () => {
    const result = buildWithRatingsWhereClause({
      returnOnlyIsRelevant: true,
    });

    expect(result.clause).toContain(
      'NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air',
    );
    expect(result.clause).toContain('air."isRelevant" IS NOT NULL');
    expect(result.replacements).toEqual({});
  });

  test("buildWithRatingsWhereClause emits cursor predicate", () => {
    const result = buildWithRatingsWhereClause({}, 123);

    expect(result.clause).toBe("WHERE a.id > :cursor");
    expect(result.replacements).toEqual({ cursor: 123 });
  });

  test("buildWithRatingsWhereClause combines filters and cursor with AND", () => {
    const result = buildWithRatingsWhereClause(
      {
        returnOnlyThisCreatedAtDateOrAfter: "2026-07-01",
        returnOnlyThisPublishedDateOrAfter: "2026-06-01",
        returnOnlyIsNotApproved: true,
        returnOnlyIsRelevant: true,
      },
      456,
    );

    expect(result.clause).toBe(
      [
        'WHERE a."createdAt" >= :returnOnlyThisCreatedAtDateOrAfter',
        'a."publishedDate" >= :returnOnlyThisPublishedDateOrAfter',
        'NOT EXISTS (SELECT 1 FROM "ArticleApproveds" aa WHERE aa."articleId" = a.id AND aa."isApproved" = true)',
        'NOT EXISTS (SELECT 1 FROM "ArticleIsRelevants" air WHERE air."articleId" = a.id AND air."isRelevant" IS NOT NULL)',
        "a.id > :cursor",
      ].join(" AND "),
    );
    expect(result.replacements).toEqual({
      returnOnlyThisCreatedAtDateOrAfter: "2026-07-01",
      returnOnlyThisPublishedDateOrAfter: "2026-06-01",
      cursor: 456,
    });
  });

  test("sqlQueryArticlesAndAiScores returns empty array without SQL for empty ids", async () => {
    await expect(sqlQueryArticlesAndAiScores([], 1)).resolves.toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
