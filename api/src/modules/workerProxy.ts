import axios from "axios";
import type { Response } from "express";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized ? normalized.replace(/\/+$/, "") : null;
}

export function getWorkerPythonBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.URL_BASE_NEWS_NEXUS_PYTHON_QUEUER);
}

export function getWorkerNodeBaseUrl(): string | null {
  return normalizeBaseUrl(process.env.URL_BASE_NEWS_NEXUS_WORKER_NODE);
}

export function getRequiredWorkerPythonBaseUrl(
  res: Response,
): string | null {
  const baseUrl = getWorkerPythonBaseUrl();
  if (!baseUrl) {
    res.status(500).json({
      result: false,
      message: "URL_BASE_NEWS_NEXUS_PYTHON_QUEUER is not configured.",
    });
    return null;
  }
  return baseUrl;
}

export function getRequiredWorkerNodeBaseUrl(res: Response): string | null {
  const baseUrl = getWorkerNodeBaseUrl();
  if (!baseUrl) {
    res.status(500).json({
      result: false,
      message: "URL_BASE_NEWS_NEXUS_WORKER_NODE is not configured.",
    });
    return null;
  }
  return baseUrl;
}

export function forwardAxiosError(
  res: Response,
  error: unknown,
): Response {
  if (axios.isAxiosError(error)) {
    return res.status(error.response?.status || 500).json(
      error.response?.data || {
        result: false,
        message: error.message,
      },
    );
  }

  return res.status(500).json({
    result: false,
    message: getErrorMessage(error),
  });
}

export function forwardWorkerPythonAxiosError(
  res: Response,
  error: unknown,
): Response {
  if (
    axios.isAxiosError(error) &&
    !error.response &&
    error.code === "ECONNREFUSED"
  ) {
    return res.status(502).json({
      result: false,
      message:
        "Unable to reach the worker-python app. Make sure the worker-python service is running and try again.",
    });
  }
  return forwardAxiosError(res, error);
}

export function forwardWorkerNodeAxiosError(
  res: Response,
  error: unknown,
): Response {
  if (
    axios.isAxiosError(error) &&
    !error.response &&
    error.code === "ECONNREFUSED"
  ) {
    return res.status(502).json({
      result: false,
      message:
        "Unable to reach the worker-node app. Make sure the worker-node service is running and try again.",
    });
  }
  return forwardAxiosError(res, error);
}
