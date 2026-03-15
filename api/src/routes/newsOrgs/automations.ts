import express from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { authenticateToken } from '../../modules/userAuthentication';
import logger from '../../modules/logger';

const router = express.Router();

type RequestWithFile = express.Request & {
  file?: any;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAutomationExcelDir(): string | null {
  return process.env.PATH_TO_AUTOMATION_EXCEL_FILES || null;
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

export = router;
