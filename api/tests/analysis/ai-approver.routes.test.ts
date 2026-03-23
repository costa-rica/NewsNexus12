import express from "express";
import request from "supertest";

jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 7, email: "tester@example.com" };
    next();
  },
}));

const mockAxios = {
  isAxiosError: jest.fn(),
  post: jest.fn(),
};

jest.mock("axios", () => mockAxios);

const mockGetCanonicalArticleContents02Row = jest.fn();

jest.mock("../../src/modules/newsOrgs/articleContents02Seed", () => ({
  getCanonicalArticleContents02Row: (...args: unknown[]) =>
    mockGetCanonicalArticleContents02Row(...args),
  isSuccessfulArticleContents02Row: (row: { status?: string | null; content?: string | null }) =>
    row.status === "success" &&
    typeof row.content === "string" &&
    row.content.trim().length > 0,
}));

const mockAiApproverPromptVersion = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
};

const mockAiApproverArticleScore = {
  count: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
};

const mockArticle = {
  findByPk: jest.fn(),
};

jest.mock("@newsnexus/db-models", () => ({
  Article: mockArticle,
  AiApproverPromptVersion: mockAiApproverPromptVersion,
  AiApproverArticleScore: mockAiApproverArticleScore,
}));

const aiApproverRouter = require("../../src/routes/analysis/ai-approver");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/analysis/ai-approver", aiApproverRouter);
  return app;
}

function buildScoreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    articleId: 77,
    promptVersionId: 5,
    resultStatus: "completed",
    score: 0.9,
    reason: "reason",
    errorCode: null,
    errorMessage: null,
    isHumanApproved: null,
    reasonHumanRejected: null,
    createdAt: "2026-03-17T00:00:00.000Z",
    updatedAt: "2026-03-17T00:00:00.000Z",
    AiApproverPromptVersion: {
      id: 5,
      name: "Residential Fire",
      description: "desc",
      promptInMarkdown: "# prompt",
      isActive: true,
      endedAt: null,
    },
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("analysis ai approver routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER = "http://worker-python";
  });

  test("GET /analysis/ai-approver/prompts returns prompt rows", async () => {
    mockAiApproverPromptVersion.findAll.mockResolvedValue([
      { id: 2, name: "Residential Fire", isActive: true },
    ]);

    const app = buildApp();
    const response = await request(app).get("/analysis/ai-approver/prompts");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.count).toBe(1);
  });

  test("POST /analysis/ai-approver/prompts validates required fields", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/prompts")
      .send({ name: "", promptInMarkdown: "" });

    expect(response.status).toBe(400);
    expect(response.body.result).toBe(false);
  });

  test("POST /analysis/ai-approver/prompts creates a prompt row", async () => {
    mockAiApproverPromptVersion.create.mockResolvedValue({
      id: 3,
      name: "Residential Fire",
      isActive: true,
    });

    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/prompts")
      .send({
        name: "Residential Fire",
        description: "Prompt for house fires",
        promptInMarkdown: "# Task",
        isActive: true,
      });

    expect(response.status).toBe(201);
    expect(response.body.result).toBe(true);
    expect(mockAiApproverPromptVersion.create).toHaveBeenCalledWith({
      name: "Residential Fire",
      description: "Prompt for house fires",
      promptInMarkdown: "# Task",
      isActive: true,
      endedAt: null,
    });
  });

  test("GET /analysis/ai-approver/review-article-content/:articleId returns article content from ArticleContents02", async () => {
    mockArticle.findByPk.mockResolvedValue({
      id: 77,
      title: "Stored article title",
    });
    mockGetCanonicalArticleContents02Row.mockResolvedValue({
      id: 201,
      articleId: 77,
      status: "success",
      content: "Stored article content",
    });

    const app = buildApp();
    const response = await request(app).get(
      "/analysis/ai-approver/review-article-content/77",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      articleId: 77,
      title: "Stored article title",
      hasArticleContent: true,
      content: "Stored article content",
      contentSource: "article-contents-02",
    });
    expect(mockGetCanonicalArticleContents02Row).toHaveBeenCalledWith(77);
  });

  test("GET /analysis/ai-approver/review-article-content/:articleId returns empty content shape when no ArticleContents02 row exists", async () => {
    mockArticle.findByPk.mockResolvedValue({
      id: 78,
      title: "Article without scraped content",
    });
    mockGetCanonicalArticleContents02Row.mockResolvedValue(null);

    const app = buildApp();
    const response = await request(app).get(
      "/analysis/ai-approver/review-article-content/78",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      articleId: 78,
      title: "Article without scraped content",
      hasArticleContent: false,
      content: null,
      contentSource: null,
    });
  });

  test("GET /analysis/ai-approver/review-article-content/:articleId returns empty content shape when the canonical row is not successful", async () => {
    mockArticle.findByPk.mockResolvedValue({
      id: 79,
      title: "Article with failed scraped content",
    });
    mockGetCanonicalArticleContents02Row.mockResolvedValue({
      id: 301,
      articleId: 79,
      status: "fail",
      content: "Some content that should not count",
    });

    const app = buildApp();
    const response = await request(app).get(
      "/analysis/ai-approver/review-article-content/79",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      result: true,
      articleId: 79,
      title: "Article with failed scraped content",
      hasArticleContent: false,
      content: null,
      contentSource: null,
    });
  });

  test("POST /analysis/ai-approver/review-page/start-job validates required fields", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/review-page/start-job")
      .send({
        articleId: 77,
        name: "",
        promptInMarkdown: "",
      });

    expect(response.status).toBe(400);
    expect(response.body.result).toBe(false);
  });

  test("POST /analysis/ai-approver/review-page/start-job creates an inactive prompt row and proxies worker request", async () => {
    mockArticle.findByPk.mockResolvedValue({
      id: 77,
      title: "Stored article title",
    });
    mockAiApproverPromptVersion.create.mockResolvedValue({
      id: 456,
    });
    mockAxios.post.mockResolvedValue({
      status: 202,
      data: {
        endpointName: "/ai-approver/review-page/start-job",
        jobId: "job-123",
        status: "queued",
      },
    });

    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/review-page/start-job")
      .send({
        articleId: 77,
        name: "Residential Fire-articleId: 77",
        promptInMarkdown: "# Prompt",
        sourcePromptVersionId: 15,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      result: true,
      endpointName: "/ai-approver/review-page/start-job",
      jobId: "job-123",
      status: "queued",
      promptVersionId: 456,
      articleId: 77,
    });
    expect(mockAiApproverPromptVersion.create).toHaveBeenCalledWith({
      name: "Residential Fire-articleId: 77",
      description: expect.stringMatching(
        /^userId:7, articleId:77, date:\d{4}-\d{2}-\d{2}$/,
      ),
      promptInMarkdown: "# Prompt",
      isActive: false,
      endedAt: null,
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-python/ai-approver/review-page/start-job",
      {
        articleId: 77,
        promptVersionId: 456,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });

  test("POST /analysis/ai-approver/review-page/start-job returns worker-python unavailable message on connection refusal", async () => {
    mockArticle.findByPk.mockResolvedValue({
      id: 77,
      title: "Stored article title",
    });
    mockAiApproverPromptVersion.create.mockResolvedValue({
      id: 456,
    });
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post.mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:5000",
      response: undefined,
    });

    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/review-page/start-job")
      .send({
        articleId: 77,
        name: "Residential Fire-articleId: 77",
        promptInMarkdown: "# Prompt",
      });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      result: false,
      message:
        "Unable to reach the worker-python app. Make sure the worker-python service is running and try again.",
    });
  });

  test("POST /analysis/ai-approver/prompts/:promptVersionId/copy copies an existing prompt", async () => {
    mockAiApproverPromptVersion.findByPk.mockResolvedValue({
      id: 4,
      name: "Residential Fire",
      description: "Prompt for house fires",
      promptInMarkdown: "# Task",
    });
    mockAiApproverPromptVersion.create.mockResolvedValue({
      id: 5,
      name: "Residential Fire (copy)",
    });

    const app = buildApp();
    const response = await request(app).post(
      "/analysis/ai-approver/prompts/4/copy",
    );

    expect(response.status).toBe(201);
    expect(response.body.result).toBe(true);
    expect(mockAiApproverPromptVersion.create).toHaveBeenCalledWith({
      name: "Residential Fire (copy)",
      description: "Prompt for house fires",
      promptInMarkdown: "# Task",
      isActive: false,
      endedAt: null,
    });
  });

  test("PATCH /analysis/ai-approver/prompts/:promptVersionId/active updates active state", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockAiApproverPromptVersion.findByPk.mockResolvedValue({
      id: 8,
      update,
    });

    const app = buildApp();
    const response = await request(app)
      .patch("/analysis/ai-approver/prompts/8/active")
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(update).toHaveBeenCalledWith({
      isActive: false,
      endedAt: expect.any(Date),
    });
  });

  test("DELETE /analysis/ai-approver/prompts/:promptVersionId blocks delete when score rows exist", async () => {
    mockAiApproverPromptVersion.findByPk.mockResolvedValue({
      id: 9,
      destroy: jest.fn(),
    });
    mockAiApproverArticleScore.count.mockResolvedValue(2);

    const app = buildApp();
    const response = await request(app).delete(
      "/analysis/ai-approver/prompts/9",
    );

    expect(response.status).toBe(409);
    expect(response.body.result).toBe(false);
  });

  test("DELETE /analysis/ai-approver/prompts/:promptVersionId deletes unused prompt rows", async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    mockAiApproverPromptVersion.findByPk.mockResolvedValue({
      id: 10,
      destroy,
    });
    mockAiApproverArticleScore.count.mockResolvedValue(0);

    const app = buildApp();
    const response = await request(app).delete(
      "/analysis/ai-approver/prompts/10",
    );

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });

  test("GET /analysis/ai-approver/article/:articleId returns scores and top eligible id", async () => {
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      buildScoreRow({ id: 11, score: 0.9, isHumanApproved: null }),
      buildScoreRow({ id: 12, score: 0.8, isHumanApproved: false }),
    ]);

    const app = buildApp();
    const response = await request(app).get("/analysis/ai-approver/article/77");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.topEligibleScoreId).toBe(11);
    expect(response.body.scores).toHaveLength(2);
  });

  test("GET /analysis/ai-approver/article/:articleId ignores invalid rows when choosing top eligible id", async () => {
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      buildScoreRow({
        id: 13,
        resultStatus: "invalid_response",
        score: null,
        isHumanApproved: null,
      }),
      buildScoreRow({ id: 14, score: 0.95, isHumanApproved: null }),
    ]);

    const app = buildApp();
    const response = await request(app).get("/analysis/ai-approver/article/77");

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.topEligibleScoreId).toBe(14);
  });

  test("POST /analysis/ai-approver/top-scores validates request body", async () => {
    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/top-scores")
      .send({ articleIds: ["bad"] });

    expect(response.status).toBe(400);
    expect(response.body.result).toBe(false);
  });

  test("POST /analysis/ai-approver/top-scores returns highest non-rejected score per article", async () => {
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      buildScoreRow({ id: 21, articleId: 77, score: 0.95, isHumanApproved: false }),
      buildScoreRow({ id: 22, articleId: 77, score: 0.9, isHumanApproved: null }),
      buildScoreRow({ id: 23, articleId: 88, score: 0.7, isHumanApproved: true }),
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/top-scores")
      .send({ articleIds: [77, 88] });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.topScores["77"]).toMatchObject({
      id: 22,
      articleId: 77,
      score: 0.9,
    });
    expect(response.body.topScores["88"]).toMatchObject({
      id: 23,
      articleId: 88,
      score: 0.7,
    });
  });

  test("POST /analysis/ai-approver/top-scores ignores invalid rows ahead of completed scores", async () => {
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      buildScoreRow({
        id: 24,
        articleId: 77,
        resultStatus: "invalid_response",
        score: null,
        isHumanApproved: null,
      }),
      buildScoreRow({ id: 25, articleId: 77, score: 0.95, isHumanApproved: null }),
    ]);

    const app = buildApp();
    const response = await request(app)
      .post("/analysis/ai-approver/top-scores")
      .send({ articleIds: [77] });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(response.body.topScores["77"]).toMatchObject({
      id: 25,
      articleId: 77,
      score: 0.95,
      resultStatus: "completed",
    });
  });

  test("PATCH /analysis/ai-approver/human-verify/:scoreId updates the current top eligible row", async () => {
    const scoreRow = buildScoreRow({ id: 31, articleId: 77, score: 0.9 });
    mockAiApproverArticleScore.findByPk.mockResolvedValue(scoreRow);
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      scoreRow,
      buildScoreRow({ id: 32, articleId: 77, score: 0.8, isHumanApproved: null }),
    ]);

    const app = buildApp();
    const response = await request(app)
      .patch("/analysis/ai-approver/human-verify/31")
      .send({ isHumanApproved: false, reasonHumanRejected: "Not useful" });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe(true);
    expect(scoreRow.update).toHaveBeenCalledWith({
      isHumanApproved: false,
      reasonHumanRejected: "Not useful",
    });
  });

  test("PATCH /analysis/ai-approver/human-verify/:scoreId blocks updates for non-top rows", async () => {
    const scoreRow = buildScoreRow({ id: 41, articleId: 77, score: 0.8 });
    mockAiApproverArticleScore.findByPk.mockResolvedValue(scoreRow);
    mockAiApproverArticleScore.findAll.mockResolvedValue([
      buildScoreRow({ id: 40, articleId: 77, score: 0.9, isHumanApproved: null }),
      scoreRow,
    ]);

    const app = buildApp();
    const response = await request(app)
      .patch("/analysis/ai-approver/human-verify/41")
      .send({ isHumanApproved: true });

    expect(response.status).toBe(409);
    expect(response.body.result).toBe(false);
  });
});
