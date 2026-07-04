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
  sqlQueryArticleIdsForArticlesRoute: jest.fn(),
  sqlQueryCountArticlesForArticlesRoute: jest.fn(),
  sqlQueryArticleIdsForWithRatingsRoute: jest.fn(),
  sqlQueryCountArticlesForWithRatingsRoute: jest.fn(),
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

const mockArticleApprovedModel = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
};

const mockArtificialIntelligenceModel = {
  findOne: jest.fn(),
};

jest.mock("@newsnexus/db-models", () => ({
  Article: mockArticleModel,
  State: {},
  ArticleIsRelevant: {},
  ArticleApproved: mockArticleApprovedModel,
  EntityWhoFoundArticle: {},
  ArticleStateContract: {},
  ArticleContents02: {},
  ArtificialIntelligence: mockArtificialIntelligenceModel,
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
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      0,
    );
  });

  const buildHydratedArticle = (id: number) => ({
    id,
    title: `Article ${id}`,
    description: `Description ${id}`,
    publishedDate: "2026-07-01",
    publicationName: "Example News",
    url: `https://example.com/${id}`,
    publisherFinalUrl: null,
    hasArticleContent: true,
    States: [{ id: 1, name: "Ohio" }],
    ArticleIsRelevants: [],
    ArticleApproveds: [],
    ArticleRevieweds: [],
    NewsApiRequest: {
      NewsArticleAggregatorSource: {
        nameOfOrg: "Example Org",
      },
    },
    StateAssignment: null,
  });

  const mockAiLookups = () => {
    mockArtificialIntelligenceModel.findOne
      .mockResolvedValueOnce({
        EntityWhoCategorizedArticles: [{ id: 11 }],
      })
      .mockResolvedValueOnce({
        EntityWhoCategorizedArticles: [{ id: 22 }],
      });
    mockQueriesSqlModule.sqlQueryArticlesAndAiScores
      .mockResolvedValueOnce([
        { articleId: 10, keywordRating: 0.9, keyword: "semantic" },
        { articleId: 11, keywordRating: 0.8, keyword: "semantic" },
        { articleId: 21, keywordRating: 0.7, keyword: "semantic" },
        { articleId: 22, keywordRating: 0.6, keyword: "semantic" },
      ])
      .mockResolvedValueOnce([
        { articleId: 10, keywordRating: 0.5, keyword: "location" },
        { articleId: 11, keywordRating: 0.4, keyword: "location" },
        { articleId: 21, keywordRating: 0.3, keyword: "location" },
        { articleId: 22, keywordRating: 0.2, keyword: "location" },
      ]);
  };

  test("POST /articles returns grouped article contract fields", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue([
      10,
    ]);
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      1,
    );
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
    expect(mockQueriesSqlModule.sqlQueryArticles).toHaveBeenCalledWith({
      articleIds: [10],
    });
    expect(mockQueriesSqlModule.sqlQueryArticlesWithStates).toHaveBeenCalledWith(
      [10],
    );
    expect(mockQueriesSqlModule.sqlQueryArticlesIsRelevant).toHaveBeenCalledWith(
      [10],
    );
    expect(mockQueriesSqlModule.sqlQueryArticlesApproved).toHaveBeenCalledWith([
      10,
    ]);
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
    expect(response.body).toMatchObject({
      articleCount: 1,
      limit: 20000,
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
  });

  test("POST /articles applies default limit", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      0,
    );

    const app = buildApp();
    const response = await request(app).post("/articles").send({});

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute,
    ).toHaveBeenCalledWith(expect.any(Object), null, 20000);
    expect(response.body.limit).toBe(20000);
  });

  test("POST /articles clamps limit above max", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      0,
    );

    const app = buildApp();
    const response = await request(app)
      .post("/articles")
      .send({ limit: 50000 });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute,
    ).toHaveBeenCalledWith(expect.any(Object), null, 40000);
    expect(response.body.limit).toBe(40000);
  });

  test("POST /articles derives hasMore and nextCursor from extra id", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue([
      10, 11, 12,
    ]);
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      3,
    );
    mockQueriesSqlModule.sqlQueryArticles.mockResolvedValue([
      {
        articleId: 10,
        title: "Article 10",
        description: "Desc 10",
        publishedDate: "2026-02-20",
        url: "https://example.com/a10",
      },
      {
        articleId: 11,
        title: "Article 11",
        description: "Desc 11",
        publishedDate: "2026-02-21",
        url: "https://example.com/a11",
      },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesWithStates.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesIsRelevant.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesApproved.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app).post("/articles").send({ limit: 2 });

    expect(response.status).toBe(200);
    expect(mockQueriesSqlModule.sqlQueryArticles).toHaveBeenCalledWith({
      articleIds: [10, 11],
    });
    expect(mockQueriesSqlModule.sqlQueryArticlesWithStates).toHaveBeenCalledWith(
      [10, 11],
    );
    expect(mockQueriesSqlModule.sqlQueryArticlesIsRelevant).toHaveBeenCalledWith(
      [10, 11],
    );
    expect(mockQueriesSqlModule.sqlQueryArticlesApproved).toHaveBeenCalledWith([
      10, 11,
    ]);
    expect(response.body).toMatchObject({
      articleCount: 2,
      limit: 2,
      nextCursor: 11,
      hasMore: true,
      totalCount: 3,
    });
  });

  test("POST /articles returns null nextCursor when no more chunks", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue([
      21, 22,
    ]);
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      2,
    );
    mockQueriesSqlModule.sqlQueryArticles.mockResolvedValue([
      {
        articleId: 21,
        title: "Article 21",
        description: "Desc 21",
        publishedDate: "2026-02-20",
        url: "https://example.com/a21",
      },
      {
        articleId: 22,
        title: "Article 22",
        description: "Desc 22",
        publishedDate: "2026-02-21",
        url: "https://example.com/a22",
      },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesWithStates.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesIsRelevant.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesApproved.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app).post("/articles").send({ limit: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      articleCount: 2,
      hasMore: false,
      nextCursor: null,
      totalCount: 2,
    });
  });

  test("POST /articles skips totalCount when cursor is supplied", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue([
      21,
    ]);
    mockQueriesSqlModule.sqlQueryArticles.mockResolvedValue([
      {
        articleId: 21,
        title: "Article 21",
        description: "Desc 21",
        publishedDate: "2026-02-20",
        url: "https://example.com/a21",
      },
    ]);
    mockQueriesSqlModule.sqlQueryArticlesWithStates.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesIsRelevant.mockResolvedValue([]);
    mockQueriesSqlModule.sqlQueryArticlesApproved.mockResolvedValue([]);

    const app = buildApp();
    const response = await request(app)
      .post("/articles")
      .send({ cursor: 11, limit: 2 });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute,
    ).toHaveBeenCalledWith(expect.any(Object), 11, 2);
    expect(
      mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute,
    ).not.toHaveBeenCalled();
    expect(response.body.totalCount).toBeNull();
  });

  test("POST /articles returns empty chunk without hydration queries", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForArticlesRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForArticlesRoute.mockResolvedValue(
      0,
    );

    const app = buildApp();
    const response = await request(app).post("/articles").send({ limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      articlesArray: [],
      articleCount: 0,
      limit: 2,
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    });
    expect(mockQueriesSqlModule.sqlQueryArticles).not.toHaveBeenCalled();
    expect(mockQueriesSqlModule.sqlQueryArticlesWithStates).not.toHaveBeenCalled();
    expect(mockQueriesSqlModule.sqlQueryArticlesIsRelevant).not.toHaveBeenCalled();
    expect(mockQueriesSqlModule.sqlQueryArticlesApproved).not.toHaveBeenCalled();
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

  test("POST /articles/with-ratings applies default limit and returns empty chunk", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForWithRatingsRoute.mockResolvedValue(
      0,
    );

    const app = buildApp();
    const response = await request(app)
      .post("/articles/with-ratings")
      .send({ semanticScorerEntityName: "NewsNexusSemanticScorer02" });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute,
    ).toHaveBeenCalledWith(expect.any(Object), null, 20000);
    expect(response.body).toMatchObject({
      articleCount: 0,
      articlesArray: [],
      limit: 20000,
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    });
    expect(mockQueriesSqlModule.sqlQueryArticlesAndAiScores).not.toHaveBeenCalled();
  });

  test("POST /articles/with-ratings clamps limit above max", async () => {
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue(
      [],
    );
    mockQueriesSqlModule.sqlQueryCountArticlesForWithRatingsRoute.mockResolvedValue(
      0,
    );

    const app = buildApp();
    const response = await request(app)
      .post("/articles/with-ratings")
      .send({
        semanticScorerEntityName: "NewsNexusSemanticScorer02",
        limit: 50000,
      });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute,
    ).toHaveBeenCalledWith(expect.any(Object), null, 40000);
    expect(response.body.limit).toBe(40000);
  });

  test("POST /articles/with-ratings derives hasMore and nextCursor from extra id", async () => {
    mockAiLookups();
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue([
      10, 11, 12,
    ]);
    mockQueriesSqlModule.sqlQueryCountArticlesForWithRatingsRoute.mockResolvedValue(
      3,
    );
    mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute.mockResolvedValue([
      buildHydratedArticle(10),
      buildHydratedArticle(11),
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/articles/with-ratings")
      .send({
        semanticScorerEntityName: "NewsNexusSemanticScorer02",
        limit: 2,
      });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute,
    ).toHaveBeenCalledWith([10, 11]);
    expect(response.body).toMatchObject({
      articleCount: 2,
      limit: 2,
      nextCursor: 11,
      hasMore: true,
      totalCount: 3,
    });
    expect(response.body.articlesArray).toHaveLength(2);
    expect(response.body.articlesArray[0]).toMatchObject({
      id: 10,
      semanticRatingMax: 0.9,
      locationClassifierScore: 0.5,
    });
  });

  test("POST /articles/with-ratings returns null nextCursor when no more chunks", async () => {
    mockAiLookups();
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue([
      21, 22,
    ]);
    mockQueriesSqlModule.sqlQueryCountArticlesForWithRatingsRoute.mockResolvedValue(
      2,
    );
    mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute.mockResolvedValue([
      buildHydratedArticle(21),
      buildHydratedArticle(22),
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/articles/with-ratings")
      .send({
        semanticScorerEntityName: "NewsNexusSemanticScorer02",
        limit: 3,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      articleCount: 2,
      hasMore: false,
      nextCursor: null,
      totalCount: 2,
    });
  });

  test("POST /articles/with-ratings skips totalCount when cursor is supplied", async () => {
    mockAiLookups();
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue([
      21,
    ]);
    mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute.mockResolvedValue([
      buildHydratedArticle(21),
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/articles/with-ratings")
      .send({
        semanticScorerEntityName: "NewsNexusSemanticScorer02",
        cursor: 11,
        limit: 2,
      });

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute,
    ).toHaveBeenCalledWith(expect.any(Object), 11, 2);
    expect(
      mockQueriesSqlModule.sqlQueryCountArticlesForWithRatingsRoute,
    ).not.toHaveBeenCalled();
    expect(response.body.totalCount).toBeNull();
  });

  test("GET /articles/test-sql returns bounded modified articles", async () => {
    mockArtificialIntelligenceModel.findOne.mockResolvedValue({
      EntityWhoCategorizedArticles: [{ id: 11 }],
    });
    mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute.mockResolvedValue([
      10, 11,
    ]);
    mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute.mockResolvedValue([
      buildHydratedArticle(10),
      buildHydratedArticle(11),
    ]);
    mockQueriesSqlModule.sqlQueryArticlesAndAiScores.mockResolvedValue([
      { articleId: 10, keywordRating: 0.9, keyword: "semantic" },
    ]);

    const app = buildApp();
    const response = await request(app).get("/articles/test-sql");

    expect(response.status).toBe(200);
    expect(
      mockQueriesSqlModule.sqlQueryArticleIdsForWithRatingsRoute,
    ).toHaveBeenCalledWith({}, null, 20000);
    expect(
      mockQueriesSqlModule.sqlQueryArticlesForWithRatingsRoute,
    ).toHaveBeenCalledWith([10, 11]);
    expect(response.body.articlesArrayModified).toHaveLength(2);
    expect(response.body.articlesArrayModified[0]).toMatchObject({
      id: 10,
      semanticRatingMax: 0.9,
      semanticRatingMaxLabel: "semantic",
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

  test("POST /articles/approve/:articleId stores publisherFinalUrl from successful scraped content", async () => {
    mockGetCanonicalArticleContents02Row.mockResolvedValue({
      id: 301,
      articleId: 77,
      status: "success",
      content: "Stored article content",
      publisherFinalUrl: "https://publisher.example.com/final-story",
    });
    mockArticleApprovedModel.findOne.mockResolvedValue(null);
    mockArticleApprovedModel.create.mockResolvedValue({ id: 1 });

    const app = buildApp();
    const response = await request(app)
      .post("/articles/approve/77")
      .send({
        approvedStatus: "Approve",
        headlineForPdfReport: "Article 77",
        publicationNameForPdfReport: "Example News",
        publicationDateForPdfReport: "2026-03-23",
        textForPdfReport: "Approved content",
        urlForPdfReport: "https://google.example.com/rss/story",
        kmNotes: "",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      status: "articleId 77 is approved",
    });
    expect(mockArticleApprovedModel.create).toHaveBeenCalledWith({
      articleId: 77,
      userId: 1,
      isApproved: true,
      approvedStatus: "Approve",
      headlineForPdfReport: "Article 77",
      publicationNameForPdfReport: "Example News",
      publicationDateForPdfReport: "2026-03-23",
      textForPdfReport: "Approved content",
      urlForPdfReport: "https://publisher.example.com/final-story",
      kmNotes: "",
    });
  });
});
