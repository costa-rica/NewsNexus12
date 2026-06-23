import express from 'express';
import axios from 'axios';
import { authenticateToken } from '../../modules/userAuthentication';
import logger from '../../modules/logger';

const router = express.Router();

function getWorkerNodeBaseUrl(): string | null {
  const raw = process.env.URL_BASE_NEWS_NEXUS_WORKER_NODE ?? '';
  const trimmed = raw.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : null;
}

function getRequiredWorkerNodeBaseUrl(res: express.Response): string | null {
  const url = getWorkerNodeBaseUrl();
  if (!url) {
    res.status(500).json({
      result: false,
      message: 'URL_BASE_NEWS_NEXUS_WORKER_NODE is not configured.',
    });
    return null;
  }
  return url;
}

function forwardAxiosError(res: express.Response, error: unknown): void {
  if (axios.isAxiosError(error)) {
    res.status(error.response?.status ?? 500).json(
      error.response?.data ?? { result: false, message: error.message }
    );
    return;
  }
  res.status(500).json({
    result: false,
    message: error instanceof Error ? error.message : String(error),
  });
}

router.post('/start', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.post(`${baseUrl}/orchestrator/start`, req.body, {
      headers: { 'Content-Type': 'application/json' },
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: POST /start failed', error);
    forwardAxiosError(res, error);
  }
});

router.get('/active-run', authenticateToken, async (_req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.get(`${baseUrl}/orchestrator/active-run`);
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: GET /active-run failed', error);
    forwardAxiosError(res, error);
  }
});

router.get('/runs', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const { limit, offset } = req.query;
    const params: Record<string, unknown> = {};
    if (limit !== undefined) params.limit = limit;
    if (offset !== undefined) params.offset = offset;
    const response = await axios.get(`${baseUrl}/orchestrator/runs`, { params });
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: GET /runs failed', error);
    forwardAxiosError(res, error);
  }
});

router.get('/runs/:id', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.get(`${baseUrl}/orchestrator/runs/${req.params.id}`);
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: GET /runs/:id failed', error);
    forwardAxiosError(res, error);
  }
});

router.get('/runs/:id/continuation-assessment', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.get(
      `${baseUrl}/orchestrator/runs/${req.params.id}/continuation-assessment`
    );
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: GET /runs/:id/continuation-assessment failed', error);
    forwardAxiosError(res, error);
  }
});

router.post('/runs/:id/continue', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.post(
      `${baseUrl}/orchestrator/runs/${req.params.id}/continue`,
      req.body,
      { headers: { 'Content-Type': 'application/json' } }
    );
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: POST /runs/:id/continue failed', error);
    forwardAxiosError(res, error);
  }
});

router.post('/runs/:id/cancel', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.post(
      `${baseUrl}/orchestrator/runs/${req.params.id}/cancel`,
      {},
      { headers: { 'Content-Type': 'application/json' } }
    );
    return res.status(response.status).json(response.data);
  } catch (error) {
    logger.error('orchestrator proxy: POST /runs/:id/cancel failed', error);
    forwardAxiosError(res, error);
  }
});

router.get('/runs/:id/report', authenticateToken, async (req, res) => {
  const baseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!baseUrl) return;

  try {
    const response = await axios.get(
      `${baseUrl}/orchestrator/runs/${req.params.id}/report`,
      { responseType: 'stream' }
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    const disposition = response.headers['content-disposition'];
    if (disposition) {
      res.setHeader('Content-Disposition', disposition as string);
    }
    response.data.pipe(res);
  } catch (error) {
    logger.error('orchestrator proxy: GET /runs/:id/report failed', error);
    forwardAxiosError(res, error);
  }
});

export = router;
