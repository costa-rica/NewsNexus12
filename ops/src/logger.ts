import fs from 'node:fs';
import path from 'node:path';
import { createLogger, format, transports, Logger } from 'winston';
import type { OpsConfig } from './config';

// Keep the output convention aligned with worker-node's human-readable logger.
const humanReadableFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const metadata = Object.entries(meta)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    const line = `${timestamp} [${level.toUpperCase()}] ${stack ?? message}`;
    return metadata ? `${line} ${metadata}` : line;
  })
);

export const initializeLogger = (config: OpsConfig): Logger => {
  const destinations: Array<transports.ConsoleTransportInstance | transports.FileTransportInstance> = [];
  if (config.nodeEnv !== 'production') {
    destinations.push(new transports.Console());
  }
  if (config.nodeEnv !== 'development') {
    fs.mkdirSync(config.pathToLogs, { recursive: true });
    destinations.push(new transports.File({
      filename: path.join(config.pathToLogs, `${config.nameApp}.log`),
      maxsize: config.logMaxSizeMb * 1024 * 1024,
      maxFiles: config.logMaxFiles,
      tailable: true
    }));
  }
  return createLogger({
    level: config.nodeEnv === 'development' ? 'debug' : 'info',
    format: humanReadableFormat,
    transports: destinations
  });
};

export const finishLogging = (logger: Logger): Promise<void> => new Promise((resolve, reject) => {
  // Wait for Winston's transports to drain instead of forcing process.exit().
  logger.once('error', reject);
  logger.once('finish', () => {
    logger.removeListener('error', reject);
    resolve();
  });
  logger.end();
});
