import express from 'express';
import axios from 'axios';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { authenticateToken } from '../../modules/userAuthentication';
import logger from '../../modules/logger';
import {
  forwardAxiosError,
  forwardWorkerNodeAxiosError,
  forwardWorkerPythonAxiosError,
  getRequiredWorkerNodeBaseUrl,
  getRequiredWorkerPythonBaseUrl,
} from '../../modules/workerProxy';

const router = express.Router();

type RequestWithFile = express.Request & {
  file?: any;
};

function getAutomationExcelDir(): string | null {
  return process.env.PATH_TO_AUTOMATION_EXCEL_FILES || null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const storage = multer.diskStorage({
  destination: function (_req: any, _file: any, cb: any) {
    const excelFilesDir = getAutomationExcelDir();
    if (!excelFilesDir) {
      cb(new Error('PATH_TO_AUTOMATION_EXCEL_FILES is not configured'), '');
      return;
    }
    cb(null, excelFilesDir);
  },
  filename: function (req: any, _file: any, cb: any) {
    const filename = Array.isArray(req.params.filename)
      ? req.params.filename[0]
      : req.params.filename;
    cb(null, filename);
  },
});
const upload = multer({ storage });

router.get('/excel-files', authenticateToken, async (_req, res) => {
  try {
    const excelFilesDir = getAutomationExcelDir();
    if (!excelFilesDir) {
      return res
        .status(500)
        .json({ result: false, message: 'Backup directory not configured.' });
    }

    const files = await fs.promises.readdir(excelFilesDir);
    const excelFileNamesArray = files.filter((file) => file.endsWith('.xlsx'));

    res.json({ result: true, excelFileNamesArray });
  } catch (error) {
    logger.error('Error retrieving excel file list:', error);
    res.status(500).json({
      result: false,
      message: 'Internal server error',
      error: getErrorMessage(error),
    });
  }
});

router.get('/excel-file/:filename', authenticateToken, (req, res) => {
  const excelFilesDir = getAutomationExcelDir();
  if (!excelFilesDir) {
    return res.status(500).json({
      result: false,
      message: 'PATH_TO_AUTOMATION_EXCEL_FILES is not configured.',
    });
  }

  const filename = Array.isArray(req.params.filename)
    ? req.params.filename[0]
    : req.params.filename;
  const filePath = path.join(excelFilesDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ result: false, message: 'File not found.' });
  }

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );

  res.download(filePath, filename, (err) => {
    if (err) {
      logger.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ result: false, message: 'File download failed.' });
      }
    }
  });
});

router.post(
  '/excel-file/:filename',
  authenticateToken,
  upload.single('file'),
  (req: RequestWithFile, res) => {
    if (!req.file) {
      return res.status(400).json({ result: false, message: 'No file uploaded.' });
    }

    return res.json({ result: true, message: 'File uploaded successfully.' });
  }
);

router.post('/request-google-rss/start-job', authenticateToken, async (req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerNodeBaseUrl}/request-google-rss/start-job`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting Google RSS worker job:', error);
    return forwardWorkerNodeAxiosError(res, error);
  }
});

router.post('/state-assigner/start-job', authenticateToken, async (req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerNodeBaseUrl}/state-assigner/start-job`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting state assigner worker job:', error);
    return forwardWorkerNodeAxiosError(res, error);
  }
});

router.post('/article-content-scraper-02/start-job', authenticateToken, async (req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerNodeBaseUrl}/article-content-scraper-02/start-job`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting article content scraper 02 worker job:', error);
    return forwardWorkerNodeAxiosError(res, error);
  }
});

router.post('/semantic-scorer/start-job', authenticateToken, async (_req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerNodeBaseUrl}/semantic-scorer/start-job`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting semantic scorer worker job:', error);
    return forwardWorkerNodeAxiosError(res, error);
  }
});

router.get('/worker-node/latest-job', authenticateToken, async (req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  const endpointName = req.query.endpointName;
  if (typeof endpointName !== 'string' || endpointName.trim() === '') {
    return res.status(400).json({
      result: false,
      message: 'endpointName query parameter is required.',
    });
  }

  try {
    const response = await axios.get(`${workerNodeBaseUrl}/queue-info/latest-job`, {
      params: {
        endpointName: endpointName.trim(),
      },
    });

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error retrieving latest worker-node job:', error);
    return forwardAxiosError(res, error);
  }
});

router.post('/worker-node/cancel-job/:jobId', authenticateToken, async (req, res) => {
  const workerNodeBaseUrl = getRequiredWorkerNodeBaseUrl(res);
  if (!workerNodeBaseUrl) {
    return;
  }

  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  try {
    const response = await axios.post(
      `${workerNodeBaseUrl}/queue-info/cancel_job/${encodeURIComponent(jobId)}`
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error canceling worker-node job:', error);
    return forwardAxiosError(res, error);
  }
});

router.get('/worker-python/latest-job', authenticateToken, async (req, res) => {
  const workerPythonBaseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!workerPythonBaseUrl) {
    return;
  }

  const endpointName = req.query.endpointName;
  if (typeof endpointName !== 'string' || endpointName.trim() === '') {
    return res.status(400).json({
      result: false,
      message: 'endpointName query parameter is required.',
    });
  }

  try {
    const response = await axios.get(`${workerPythonBaseUrl}/queue-info/latest-job`, {
      params: {
        endpointName: endpointName.trim(),
      },
    });

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error retrieving latest worker-python job:', error);
    return forwardAxiosError(res, error);
  }
});

router.get('/worker-python/check-status/:jobId', authenticateToken, async (req, res) => {
  const workerPythonBaseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!workerPythonBaseUrl) {
    return;
  }

  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (typeof jobId !== 'string' || jobId.trim() === '') {
    return res.status(400).json({
      result: false,
      message: 'jobId route parameter is required.',
    });
  }

  try {
    const response = await axios.get(
      `${workerPythonBaseUrl}/queue-info/check-status/${encodeURIComponent(jobId.trim())}`
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error retrieving worker-python job status:', error);
    return forwardAxiosError(res, error);
  }
});

router.post('/worker-python/cancel-job/:jobId', authenticateToken, async (req, res) => {
  const workerPythonBaseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!workerPythonBaseUrl) {
    return;
  }

  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  try {
    const response = await axios.post(
      `${workerPythonBaseUrl}/queue-info/cancel-job/${encodeURIComponent(jobId)}`
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error canceling worker-python job:', error);
    return forwardAxiosError(res, error);
  }
});

router.post('/location-scorer/start-job', authenticateToken, async (req, res) => {
  const workerPythonBaseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!workerPythonBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerPythonBaseUrl}/location-scorer/start-job`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting location scorer worker job:', error);
    return forwardWorkerPythonAxiosError(res, error);
  }
});

router.post('/ai-approver/start-job', authenticateToken, async (req, res) => {
  const workerPythonBaseUrl = getRequiredWorkerPythonBaseUrl(res);
  if (!workerPythonBaseUrl) {
    return;
  }

  try {
    const response = await axios.post(
      `${workerPythonBaseUrl}/ai-approver/start-job`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return res.status(response.status).json(response.data);
  } catch (error: unknown) {
    logger.error('Error starting ai approver worker job:', error);
    return forwardWorkerPythonAxiosError(res, error);
  }
});

export = router;
