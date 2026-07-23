import express from "express";
import request from "supertest";

jest.mock("../../src/modules/logger", () => ({
  error: jest.fn(),
}));

const mockAuthenticateToken = jest.fn(
  (_req: unknown, _res: unknown, next: () => void) => next(),
);
jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: mockAuthenticateToken,
}));

const mockPrompt = {
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  update: jest.fn(),
};
const mockPrediction = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  findByPk: jest.fn(),
};
const transaction = { LOCK: { UPDATE: "UPDATE" } };
const mockSequelize = {
  transaction: jest.fn(async (callback: (value: typeof transaction) => unknown) =>
    callback(transaction),
  ),
};

jest.mock("@newsnexus/db-models", () => ({
  AiApproverPromptVersionV02: mockPrompt,
  AiApproverArticlePredictionV02: mockPrediction,
  sequelize: mockSequelize,
}));

const router = require("../../src/routes/analysis/ai-approver-v02");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/analysis/ai-approver-v02", router);
  return app;
}

function promptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Prompt",
    promptInMarkdown: "instructions",
    isActive: false,
    firstUsedAt: null,
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function predictionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    articleId: 77,
    prediction: "approved",
    humanValidation: null,
    humanComment: null,
    update: jest.fn().mockImplementation(async function (
      this: Record<string, unknown>,
      values: Record<string, unknown>,
    ) {
      Object.assign(this, values);
    }),
    ...overrides,
  };
}

describe("AI Approver V02 analysis routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("every registered V02 route includes authentication middleware", () => {
    const routeLayers = router.stack.filter(
      (layer: { route?: unknown }) => layer.route,
    );

    expect(routeLayers.length).toBe(8);
    for (const layer of routeLayers) {
      expect(layer.route.stack.length).toBeGreaterThanOrEqual(2);
      expect(layer.route.stack[0].handle).toBe(mockAuthenticateToken);
    }
  });

  test("lists prompts and normalizes blank titles on create", async () => {
    mockPrompt.findAll.mockResolvedValue([{ id: 1 }]);
    mockPrompt.create.mockResolvedValue(promptRow({ title: null }));
    const app = buildApp();

    const list = await request(app).get("/analysis/ai-approver-v02/prompts");
    const create = await request(app)
      .post("/analysis/ai-approver-v02/prompts")
      .send({ title: " ", promptInMarkdown: " instructions " });

    expect(list.body.count).toBe(1);
    expect(create.status).toBe(201);
    expect(mockPrompt.create).toHaveBeenCalledWith({
      title: null,
      promptInMarkdown: "instructions",
      isActive: false,
    });
  });

  test("returns duplicate-title conflict", async () => {
    const error = new Error("duplicate");
    error.name = "SequelizeUniqueConstraintError";
    mockPrompt.create.mockRejectedValue(error);

    const response = await request(buildApp())
      .post("/analysis/ai-approver-v02/prompts")
      .send({ title: "Same", promptInMarkdown: "instructions" });

    expect(response.status).toBe(409);
  });

  test("rejects used prompt edits but allows used prompt activation", async () => {
    const used = promptRow({ firstUsedAt: new Date() });
    mockPrompt.findByPk.mockResolvedValue(used);

    const edit = await request(buildApp())
      .patch("/analysis/ai-approver-v02/prompts/1")
      .send({ title: "Changed", promptInMarkdown: "changed" });
    const activate = await request(buildApp()).post(
      "/analysis/ai-approver-v02/prompts/1/activate",
    );

    expect(edit.status).toBe(409);
    expect(activate.status).toBe(200);
    expect(mockPrompt.update).toHaveBeenCalledWith(
      { isActive: false },
      { where: { isActive: true }, transaction },
    );
    expect(used.update).toHaveBeenCalledWith(
      { isActive: true },
      { transaction },
    );
  });

  test("deactivates a prompt without deleting it", async () => {
    const prompt = promptRow({ isActive: true });
    mockPrompt.findByPk.mockResolvedValue(prompt);

    const response = await request(buildApp()).post(
      "/analysis/ai-approver-v02/prompts/1/deactivate",
    );
    const deleteResponse = await request(buildApp()).delete(
      "/analysis/ai-approver-v02/prompts/1",
    );

    expect(response.status).toBe(200);
    expect(prompt.update).toHaveBeenCalledWith({ isActive: false });
    expect(deleteResponse.status).toBe(404);
  });

  test("returns batch and detail predictions", async () => {
    const prediction = predictionRow();
    mockPrediction.findAll.mockResolvedValue([prediction]);
    mockPrediction.findOne.mockResolvedValue(prediction);
    const app = buildApp();

    const batch = await request(app)
      .post("/analysis/ai-approver-v02/predictions/batch")
      .send({ articleIds: [77, 77] });
    const detail = await request(app).get(
      "/analysis/ai-approver-v02/predictions/article/77",
    );

    expect(batch.body.count).toBe(1);
    expect(detail.body.prediction.articleId).toBe(77);
  });

  test("updates and clears review fields independently", async () => {
    const prediction = predictionRow();
    mockPrediction.findByPk.mockResolvedValue(prediction);
    const app = buildApp();

    const comment = await request(app)
      .patch("/analysis/ai-approver-v02/predictions/4/review")
      .send({ humanComment: " useful " });
    const validation = await request(app)
      .patch("/analysis/ai-approver-v02/predictions/4/review")
      .send({ humanValidation: false });
    const clear = await request(app)
      .patch("/analysis/ai-approver-v02/predictions/4/review")
      .send({ humanComment: null, humanValidation: null });

    expect(comment.body.prediction.humanComment).toBe("useful");
    expect(validation.body.prediction.humanValidation).toBe(false);
    expect(clear.body.prediction.humanComment).toBeNull();
    expect(clear.body.prediction.humanValidation).toBeNull();
    expect(prediction.update).toHaveBeenNthCalledWith(1, {
      humanComment: "useful",
    });
    expect(prediction.update).toHaveBeenNthCalledWith(2, {
      humanValidation: false,
    });
  });

  test("validates review values and missing predictions", async () => {
    mockPrediction.findByPk.mockResolvedValue(null);
    const app = buildApp();
    const invalid = await request(app)
      .patch("/analysis/ai-approver-v02/predictions/4/review")
      .send({ humanValidation: "yes" });
    const missing = await request(app)
      .patch("/analysis/ai-approver-v02/predictions/4/review")
      .send({ humanComment: "note" });

    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
