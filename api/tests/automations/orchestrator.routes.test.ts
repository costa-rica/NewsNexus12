import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";

jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockAuthenticateToken = jest.fn(
  (_req: Request, _res: Response, next: NextFunction) => next(),
);

jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: (req: Request, res: Response, next: NextFunction) =>
    mockAuthenticateToken(req, res, next),
}));

const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  isAxiosError: jest.fn(),
};

jest.mock("axios", () => mockAxios);

const orchestratorRouter = require("../../src/routes/automations/orchestrator");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/automations/orchestrator", orchestratorRouter);
  return app;
}

describe("orchestrator automation routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.URL_BASE_NEWS_NEXUS_WORKER_NODE = "http://worker-node";
    mockAxios.isAxiosError.mockReturnValue(false);
    mockAuthenticateToken.mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next(),
    );
  });

  test("GET /automations/orchestrator/runs requires authentication", async () => {
    mockAuthenticateToken.mockImplementation((_req: Request, res: Response) =>
      res.status(401).json({ message: "Token is required" }),
    );

    const app = buildApp();
    const response = await request(app).get("/automations/orchestrator/runs");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token is required" });
    expect(mockAxios.get).not.toHaveBeenCalled();
  });

  test("GET /automations/orchestrator/runs preserves cheap continuation signal fields", async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: {
        runs: [
          {
            id: 17,
            status: "failed",
            canRequestContinuationAssessment: true,
            continuationSignalReasonCode: "failed_after_google_rss",
            continuationSignalWarnings: ["article range may include unrelated ingestion"],
          },
        ],
      },
    });

    const app = buildApp();
    const response = await request(app)
      .get("/automations/orchestrator/runs")
      .query({ limit: 10, offset: 0 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      runs: [
        {
          id: 17,
          status: "failed",
          canRequestContinuationAssessment: true,
          continuationSignalReasonCode: "failed_after_google_rss",
          continuationSignalWarnings: ["article range may include unrelated ingestion"],
        },
      ],
    });
    expect(mockAxios.get).toHaveBeenCalledWith("http://worker-node/orchestrator/runs", {
      params: {
        limit: "10",
        offset: "0",
      },
    });
  });

  test("GET /automations/orchestrator/runs/:id/continuation-assessment preserves eligible false 200 body", async () => {
    mockAxios.get.mockResolvedValue({
      status: 200,
      data: {
        eligible: false,
        blockingReasons: [
          {
            code: "source_run_completed",
            message: "The source run completed and does not need continuation.",
          },
        ],
        runId: 21,
      },
    });

    const app = buildApp();
    const response = await request(app).get(
      "/automations/orchestrator/runs/21/continuation-assessment",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      eligible: false,
      blockingReasons: [
        {
          code: "source_run_completed",
          message: "The source run completed and does not need continuation.",
        },
      ],
      runId: 21,
    });
    expect(mockAxios.get).toHaveBeenCalledWith(
      "http://worker-node/orchestrator/runs/21/continuation-assessment",
    );
  });

  test("GET /automations/orchestrator/runs/:id/continuation-assessment preserves missing source run 404 body", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.get.mockRejectedValue({
      response: {
        status: 404,
        data: {
          result: false,
          message: "Source orchestration run was not found.",
        },
      },
    });

    const app = buildApp();
    const response = await request(app).get(
      "/automations/orchestrator/runs/404/continuation-assessment",
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      result: false,
      message: "Source orchestration run was not found.",
    });
  });

  test("POST /automations/orchestrator/runs/:id/continue requires authentication", async () => {
    mockAuthenticateToken.mockImplementation((_req: Request, res: Response) =>
      res.status(401).json({ message: "Token is required" }),
    );

    const app = buildApp();
    const response = await request(app).post("/automations/orchestrator/runs/21/continue");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Token is required" });
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  test("POST /automations/orchestrator/runs/:id/continue preserves accepted continuation 202 body", async () => {
    mockAxios.post.mockResolvedValue({
      status: 202,
      data: {
        result: true,
        runId: 34,
        sourceOrchestratorRunId: 21,
        runMode: "continuation",
      },
    });

    const app = buildApp();
    const response = await request(app)
      .post("/automations/orchestrator/runs/21/continue")
      .send({ confirmedBy: "operator" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      result: true,
      runId: 34,
      sourceOrchestratorRunId: 21,
      runMode: "continuation",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-node/orchestrator/runs/21/continue",
      { confirmedBy: "operator" },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });

  test("POST /automations/orchestrator/runs/:id/continue preserves missing source run 404 body", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post.mockRejectedValue({
      response: {
        status: 404,
        data: {
          result: false,
          message: "Source orchestration run was not found.",
        },
      },
    });

    const app = buildApp();
    const response = await request(app).post("/automations/orchestrator/runs/404/continue");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      result: false,
      message: "Source orchestration run was not found.",
    });
  });

  test("POST /automations/orchestrator/runs/:id/continue preserves active-run 409 body", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          result: false,
          message: "Another orchestration run is already active.",
          activeRunId: 33,
        },
      },
    });

    const app = buildApp();
    const response = await request(app).post("/automations/orchestrator/runs/21/continue");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      result: false,
      message: "Another orchestration run is already active.",
      activeRunId: 33,
    });
  });

  test("POST /automations/orchestrator/runs/:id/continue preserves no-longer-eligible 409 body", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post.mockRejectedValue({
      response: {
        status: 409,
        data: {
          result: false,
          message: "Source orchestration run is no longer eligible for continuation.",
          assessment: {
            eligible: false,
            blockingReasons: [{ code: "already_active_continuation" }],
          },
        },
      },
    });

    const app = buildApp();
    const response = await request(app).post("/automations/orchestrator/runs/21/continue");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      result: false,
      message: "Source orchestration run is no longer eligible for continuation.",
      assessment: {
        eligible: false,
        blockingReasons: [{ code: "already_active_continuation" }],
      },
    });
  });

  test("POST /automations/orchestrator/runs/:id/continue preserves unsupported-shape 422 body", async () => {
    mockAxios.isAxiosError.mockReturnValue(true);
    mockAxios.post.mockRejectedValue({
      response: {
        status: 422,
        data: {
          result: false,
          message: "Continuation is not supported for report-only runs.",
          blockingReasons: [{ code: "report_only_continuation_deferred" }],
        },
      },
    });

    const app = buildApp();
    const response = await request(app).post("/automations/orchestrator/runs/21/continue");

    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      result: false,
      message: "Continuation is not supported for report-only runs.",
      blockingReasons: [{ code: "report_only_continuation_deferred" }],
    });
  });
});
