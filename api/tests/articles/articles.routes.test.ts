import express from "express";
import request from "supertest";

jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: "tester@example.com" };
    next();
  },
}));

const mockArticlesModule = {
  createNewsApiRequestsArray: jest.fn(),
  createArticlesApprovedArray: jest.fn(),
  formatArticleDetails: jest.fn(),
};

jest.mock("../../src/modules/articles", () => mockArticlesModule);

const mockGetCanonicalArticleContents02Row = jest.fn();

jest.mock("../../src/modules/newsOrgs/articleContents02Seed", () => ({
  getCanonicalArticleContents02Row: (...args: unknown[]) =>
    mockGetCanonicalArticleContents02Row(...args),
  isSuccessfulArticleContents02Row: (row: {
    status?: string | null;
    content?: string | null;
  }) =>
    row.status === "success" &&
    typeof row.content === "string" &&
    row.content.trim().length > 0,
}));

const mockCommonModule = {
  getLastThursdayAt20hInNyTimeZone: jest.fn(),
};

jest.mock("../../src/modules/common", () => mockCommonModule);

const mockQueriesSqlModule = {
  sqlQueryArticles: jest.fn(),
  sqlQueryArticlesWithStatesApprovedReportContract: jest.fn(),
  sqlQueryArticlesForWithRatingsRoute: jest.fn(),
  sqlQueryArticlesWithStates: jest.fn(),
  sqlQueryArticlesApproved: jest.fn(),
  sqlQueryArticlesReport: jest.fn(),
  sqlQueryArticlesIsRelevant: jest.fn(),
  sqlQueryArticlesAndAiScores: jest.fn(),
  sqlQueryArticleDetails: jest.fn(),
};

jest.mock("../../src/modules/queriesSql", () => mockQueriesSqlModule);

const mockArticleModel = {
  findByPk: jest.fn(),
};

jest.mock("@newsnexus/db-models", () => ({
  Article: mockArticleModel,
  State: {},
  ArticleIsRelevant: {},
  ArticleApproved: {},
  EntityWhoFoundArticle: {},
  ArticleStateContract: {},
  ArticleContents02: {},
  ArtificialIntelligence: {},
  ArticleReviewed: {},
  EntityWhoCategorizedArticle: {},
}));

const articlesRouter = require("../../src/routes/articles");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/articles", articlesRouter);
  return app;
}

describe("articles routes contract tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("POST /articles returns grouped article contract fields", async () => {
    mockQueriesSqlModule.sqlQueryArticles.mockResolvedValue([
      {
        articleId: 10,
        title: "Article 10",
        description: "Desc",
        publishedDate: "2026-02-20",
        url: "https://example.com/a10",
        andString: "injury",
        orString: "recall",
        notString: "sports",
      },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesWithStates.mockResolvedValue([
      { articleId: 10, stateId: 1, stateName: "Texas", abbreviation: "TX" },
      {
        articleId: 10,
        stateId: 2,
        stateName: "California",
        abbreviation: "CA",
      },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesIsRelevant.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesApproved.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app).post("/articles").send({});

    expect(response.status).toBe(200);
    expect(response.body.articlesArray).toHaveLength(1);
    expect(response.body.articlesArray[0]).toMatchObject({
      id: 10,
      title: "Article 10",
      statesStringCommaSeparated: "TX, CA",
      articleIsApproved: false,
      ArticleIsRelevant: true,
    });
    expect(response.body.articlesArray[0].keyword).toContain("AND injury");
    expect(response.body.articlesArray[0].keyword).toContain("OR recall");
    expect(response.body.articlesArray[0].keyword).toContain("NOT sports");
  });

  test("GET /articles/approved returns only approved entries with derived fields", async () => {
    mockQueriesSqlModule.sqlQueryArticlesWithStatesApprovedReportContract.mockResolvedValue(
      [
        {
          id: 100,
          States: [{ abbreviation: "OH" }],
          ArticleApproveds: [{ isApproved: true }],
          ArticleReportContracts: [{ articleAcceptedByCpsc: 1 }],
        },
        {
          id: 101,
          States: [{ abbreviation: "MI" }],
          ArticleApproveds: [{ isApproved: false }],
          ArticleReportContracts: [],
        },
      ],
    );

    const app = buildApp();
    const response = await request(app).get("/articles/approved");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty(
      "timeToRenderResponseFromApiInSeconds",
    );
    expect(response.body.articlesArray).toHaveLength(1);
    expect(response.body.articlesArray[0]).toMatchObject({
      id: 100,
      isSubmitted: "Yes",
      articleHasBeenAcceptedByAll: true,
      stateAbbreviation: "OH",
    });
  });

  test("GET /articles/summary-statistics returns expected counters", async () => {
    mockCommonModule.getLastThursdayAt20hInNyTimeZone.mockReturnValue(
      new Date("2026-02-20T00:00:00.000Z"),
    );
    mockQueriesSqlModule.sqlQueryArticles.mockResolvedValue([
      { articleId: 1, createdAt: "2026-02-19T00:00:00.000Z" },
      { articleId: 2, createdAt: "2026-02-21T00:00:00.000Z" },
      { articleId: 3, createdAt: "2026-02-22T00:00:00.000Z" },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesWithStates.mockResolvedValue([
      { articleId: 1, stateId: 10 },
      { articleId: 1, stateId: 11 },
      { articleId: 2, stateId: null },
      { articleId: 3, stateId: 12 },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesApproved.mockResolvedValue([
      { articleId: 1 },
      { articleId: 1 },
      { articleId: 2 },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesReport.mockResolvedValue([
      { articleId: 1, reportId: 500 },
      { articleId: 2, reportId: null },
    ]);

    const app = buildApp();
    const response = await request(app).get("/articles/summary-statistics");

    expect(response.status).toBe(200);
    expect(response.body.summaryStatistics).toMatchObject({
      articlesCount: 3,
      articlesSinceLastThursday20hEst: 2,
      articleHasStateCount: 2,
      articleIsApprovedCount: 2,
      approvedButNotInReportCount: 1,
    });
  });

  test("GET /articles/article-details/:articleId rejects invalid id", async () => {
    const app = buildApp();
    const response = await request(app).get(
      "/articles/article-details/not-a-number",
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  test("GET /articles/article-details/:articleId returns formatted details", async () => {
    mockQueriesSqlModule.sqlQueryArticleDetails.mockResolvedValue([
      { articleId: 77 },
    ]);
    mockArticlesModule.formatArticleDetails.mockReturnValue({
      id: 77,
      title: "Article 77",
      states: [],
    });

    const app = buildApp();
    const response = await request(app).get("/articles/article-details/77");

    expect(mockQueriesSqlModule.sqlQueryArticleDetails).toHaveBeenCalledWith(
      77,
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 77,
      title: "Article 77",
    });
  });

  test("GET /articles/review-selected-content/:articleId returns scraped content when canonical row is successful", async () => {
    mockArticleModel.findByPk.mockResolvedValue({ id: 77 });
    mockGetCanonicalArticleContents02Row.mockResolvedValue({
      id: 201,
      articleId: 77,
      status: "success",
      content: "Stored article content",
    });

    const app = buildApp();
    const response = await request(app).get(
      "/articles/review-selected-content/77",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      articleId: 77,
      hasArticleContent: true,
      content: "Stored article content",
      contentSource: "article-contents-02",
    });
  });

  test("GET /articles/review-selected-content/:articleId returns empty content when canonical row is not usable", async () => {
    mockArticleModel.findByPk.mockResolvedValue({ id: 78 });
    mockGetCanonicalArticleContents02Row.mockResolvedValue({
      id: 202,
      articleId: 78,
      status: "fail",
      content: "Stored article content",
    });

    const app = buildApp();
    const response = await request(app).get(
      "/articles/review-selected-content/78",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      articleId: 78,
      hasArticleContent: false,
      content: null,
      contentSource: null,
    });
  });
});
