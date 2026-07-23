import axios from "axios";
import express from "express";

import { authenticateToken } from "../../modules/userAuthentication";
import {
  forwardWorkerPythonAxiosError,
  getRequiredWorkerPythonBaseUrl,
} from "../../modules/workerProxy";
import logger from "../../modules/logger";

const router = express.Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

async function proxy(
  req: express.Request,
  res: express.Response,
  method: "get" | "post",
  path: string,
): Promise<express.Response | void> {
  const baseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!baseUrl) {
    return;
  }
  try {
    const response =
      method === "get"
        ? await axios.get(`${baseUrl}${path}`)
        : await axios.post(`${baseUrl}${path}`, req.body ?? {}, {
            headers: { "Content-Type": "application/json" },
          });
    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error(`AI Approver V02 worker proxy failed for ${path}:`, error);
    return forwardWorkerPythonAxiosError(res, error);
  }
}

router.post("/preview", authenticateToken, (req, res) =>
  proxy(req, res, "post", "/ai-approver-v02/preview"),
);

router.post("/start", authenticateToken, (req, res) =>
  proxy(req, res, "post", "/ai-approver-v02/start"),
);

router.get("/runs/latest", authenticateToken, (req, res) =>
  proxy(req, res, "get", "/ai-approver-v02/runs/latest"),
);

router.get("/runs/:runId", authenticateToken, (req, res) =>
  proxy(
    req,
    res,
    "get",
    `/ai-approver-v02/runs/${encodeURIComponent(routeParam(req.params.runId))}`,
  ),
);

router.post("/runs/:runId/cancel", authenticateToken, (req, res) =>
  proxy(
    req,
    res,
    "post",
    `/ai-approver-v02/runs/${encodeURIComponent(routeParam(req.params.runId))}/cancel`,
  ),
);

export = router;
