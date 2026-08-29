import request from "supertest";
import app from "../helpers/testApp";

describe("app bootstrap smoke tests", () => {
  test("GET /health returns 200", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        service: "newsnexus12api",
      }),
    );
  });

  test("GET / returns 200", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("<!DOCTYPE html>");
    expect(response.text).toContain("API v12");
  });

  test.each([
    ["post", "/automations/orchestrator/start"],
    ["post", "/automations/ai-approver/start-job"],
    ["get", "/analysis/ai-approver/prompts"],
  ] as const)("%s %s is not available", async (method, route) => {
    const response = await request(app)[method](route);

    expect(response.status).toBe(404);
  });
});
