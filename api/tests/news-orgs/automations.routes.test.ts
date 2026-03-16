import express from "express";
import request from "supertest";

jest.mock("../../src/modules/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("../../src/modules/userAuthentication", () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockAxios = {
  get: jest.fn(),
  post: jest.fn(),
  isAxiosError: jest.fn(),
};

jest.mock("axios", () => mockAxios);

const automationsRouter = require("../../src/routes/newsOrgs/automations");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/automations", automationsRouter);
  return app;
}

describe("news org automations routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.URL_BASE_NEWS_NEXUS_WORKER_NODE = "http://worker-node";
    process.env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER = "http://worker-python";
  });

  test("POST /automations/request-google-rss/start-job proxies worker-node response", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        endpointName: "/request-google-rss/start-job",
        jobId: "job-1",
        status: "queued",
      },
      status: 202,
    });

    const app = buildApp();
    const response = await request(app).post(
      "/automations/request-google-rss/start-job",
    );

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      endpointName: "/request-google-rss/start-job",
      jobId: "job-1",
      status: "queued",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-node/request-google-rss/start-job",
      {},
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });

  test("GET /automations/worker-node/latest-job proxies latest worker job", async () => {
    mockAxios.get.mockResolvedValue({
      data: {
        job: {
          createdAt: "2026-03-15T12:00:00.000Z",
          endpointName: "/request-google-rss/start-job",
          jobId: "job-55",
          status: "completed",
        },
      },
      status: 200,
    });

    const app = buildApp();
    const response = await request(app).get("/automations/worker-node/latest-job").query({
      endpointName: "/request-google-rss/start-job",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      job: {
        createdAt: "2026-03-15T12:00:00.000Z",
        endpointName: "/request-google-rss/start-job",
        jobId: "job-55",
        status: "completed",
      },
    });
    expect(mockAxios.get).toHaveBeenCalledWith(
      "http://worker-node/queue-info/latest-job",
      {
        params: {
          endpointName: "/request-google-rss/start-job",
        },
      },
    );
  });

  test("POST /automations/state-assigner/start-job proxies worker-node response", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        endpointName: "/state-assigner/start-job",
        jobId: "job-2",
        status: "queued",
      },
      status: 202,
    });

    const app = buildApp();
    const response = await request(app)
      .post("/automations/state-assigner/start-job")
      .send({
        targetArticleStateReviewCount: 100,
        targetArticleThresholdDaysOld: 180,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      endpointName: "/state-assigner/start-job",
      jobId: "job-2",
      status: "queued",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-node/state-assigner/start-job",
      {
        targetArticleStateReviewCount: 100,
        targetArticleThresholdDaysOld: 180,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });

  test("POST /automations/worker-node/cancel-job/:jobId proxies cancel response", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        jobId: "job-55",
        outcome: "cancel_requested",
      },
      status: 200,
    });

    const app = buildApp();
    const response = await request(app).post(
      "/automations/worker-node/cancel-job/job-55",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobId: "job-55",
      outcome: "cancel_requested",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-node/queue-info/cancel_job/job-55",
    );
  });

  test("GET /automations/worker-python/latest-job proxies latest worker job", async () => {
    mockAxios.get.mockResolvedValue({
      data: {
        job: {
          createdAt: "2026-03-16T12:00:00.000Z",
          endpointName: "/deduper/start-job",
          jobId: "0004",
          status: "running",
        },
      },
      status: 200,
    });

    const app = buildApp();
    const response = await request(app).get("/automations/worker-python/latest-job").query({
      endpointName: "/deduper/start-job",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      job: {
        createdAt: "2026-03-16T12:00:00.000Z",
        endpointName: "/deduper/start-job",
        jobId: "0004",
        status: "running",
      },
    });
    expect(mockAxios.get).toHaveBeenCalledWith(
      "http://worker-python/queue-info/latest-job",
      {
        params: {
          endpointName: "/deduper/start-job",
        },
      },
    );
  });

  test("POST /automations/worker-python/cancel-job/:jobId proxies cancel response", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        jobId: "0004",
        outcome: "cancel_requested",
      },
      status: 200,
    });

    const app = buildApp();
    const response = await request(app).post(
      "/automations/worker-python/cancel-job/0004",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobId: "0004",
      outcome: "cancel_requested",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-python/queue-info/cancel-job/0004",
    );
  });

  test("POST /automations/location-scorer/start-job proxies worker-python response", async () => {
    mockAxios.post.mockResolvedValue({
      data: {
        endpointName: "/location-scorer/start-job",
        jobId: "0007",
        status: "queued",
      },
      status: 202,
    });

    const app = buildApp();
    const response = await request(app)
      .post("/automations/location-scorer/start-job")
      .send({
        limit: 25,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      endpointName: "/location-scorer/start-job",
      jobId: "0007",
      status: "queued",
    });
    expect(mockAxios.post).toHaveBeenCalledWith(
      "http://worker-python/location-scorer/start-job",
      {
        limit: 25,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });
});
