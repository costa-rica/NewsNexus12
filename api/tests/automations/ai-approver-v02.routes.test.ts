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

const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  isAxiosError: jest.fn(),
};

jest.mock("axios", () => mockAxios);

const router = require("../../src/routes/automations/ai-approver-v02");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/automations/ai-approver-v02", router);
  return app;
}

describe("AI Approver V02 automation routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER = "http://worker-python/";
  });

  test("every automation route includes authentication middleware", () => {
    const routeLayers = router.stack.filter(
      (layer: { route?: unknown }) => layer.route,
    );

    expect(routeLayers.length).toBe(5);
    for (const layer of routeLayers) {
      expect(layer.route.stack[0].handle).toBe(mockAuthenticateToken);
    }
  });

  test.each([
    [
      "preview",
      "/automations/ai-approver-v02/preview",
      "/ai-approver-v02/preview",
    ],
    ["start", "/automations/ai-approver-v02/start", "/ai-approver-v02/start"],
  ])("POST %s preserves worker response", async (_name, apiPath, workerPath) => {
    mockAxios.post.mockResolvedValue({
      status: 202,
      data: { runId: 7, status: "queued" },
    });
    const body = { selectionMode: "article_position_count" };

    const response = await request(buildApp()).post(apiPath).send(body);

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ runId: 7, status: "queued" });
    expect(mockAxios.post).toHaveBeenCalledWith(
      `http://worker-python${workerPath}`,
      body,
      { headers: { "Content-Type": "application/json" } },
    );
  });

  test("GET latest and detail preserve worker data", async () => {
    mockAxios.get
      .mockResolvedValueOnce({ status: 200, data: { id: 9, status: "completed" } })
      .mockResolvedValueOnce({
        status: 200,
        data: { run: { id: 9 }, queueStatus: { status: "completed" } },
      });

    const app = buildApp();
    const latest = await request(app).get(
      "/automations/ai-approver-v02/runs/latest",
    );
    const detail = await request(app).get(
      "/automations/ai-approver-v02/runs/9",
    );

    expect(latest.body.status).toBe("completed");
    expect(detail.body.queueStatus.status).toBe("completed");
    expect(mockAxios.get).toHaveBeenNthCalledWith(
      1,
      "http://worker-python/ai-approver-v02/runs/latest",
    );
    expect(mockAxios.get).toHaveBeenNthCalledWith(
      2,
      "http://worker-python/ai-approver-v02/runs/9",
    );
  });

  test("POST cancel preserves worker response", async () => {
    mockAxios.post.mockResolvedValue({
      status: 200,
      data: { runId: 9, outcome: "cancel_requested" },
    });

    const response = await request(buildApp()).post(
      "/automations/ai-approver-v02/runs/9/cancel",
    );

    expect(response.body.outcome).toBe("cancel_requested");
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-python/ai-approver-v02/runs/9/cancel",
      {},
      { headers: { "Content-Type": "application/json" } },
    );
  });

  test("forwards typed worker errors and connection failures", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: { error: "preview_expired", message: "expired" },
        },
      })
      .mockRejectedValueOnce({
        code: "ECONNREFUSED",
        response: undefined,
      });

    const app = buildApp();
    const conflict = await request(app).post(
      "/automations/ai-approver-v02/start",
    );
    const unavailable = await request(app).post(
      "/automations/ai-approver-v02/start",
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe("preview_expired");
    expect(unavailable.status).toBe(502);
  });

  test("returns clear error when worker URL is missing", async () => {
    delete process.env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER;

    const response = await request(buildApp()).post(
      "/automations/ai-approver-v02/preview",
    );

    expect(response.status).toBe(500);
    expect(response.body.message).toContain(
      "URL_BASE_NEWS_NEXUS_PYTHON_QUEUER",
    );
  });
});
