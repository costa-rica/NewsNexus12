import fs from 'node:fs';
import path from 'node:path';
import { createLogger, format, transports, Logger } from 'winston';
import { RuntimeNodeEnv } from './startup/config';

export interface LoggerConfig {
  nodeEnv: RuntimeNodeEnv;
  nameApp: string;
  pathToLogs: string;
  logMaxSizeMb: number;
  logMaxFiles: number;
}

const humanReadableLoggerFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, stack, ...meta }) => {
    const renderedMessage = stack ?? message;
    const metaEntries = Object.entries(meta).filter(([, value]) => value !== undefined);
    const renderedMeta =
      metaEntries.length > 0
        ? metaEntries
            .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
            .join(' ')
        : '';

    return renderedMeta
      ? `${timestamp} [${level.toUpperCase()}] ${renderedMessage} ${renderedMeta}`
      : `${timestamp} [${level.toUpperCase()}] ${renderedMessage}`;
  })
);

const logger = createLogger({
  level: 'info',
  format: humanReadableLoggerFormat,
  transports: [new transports.Console({ silent: true })]
});

let loggerInitialized = false;

const ensureLogDirectory = (pathToLogs: string): void => {
  fs.mkdirSync(pathToLogs, { recursive: true });
};

const resolveLogLevel = (nodeEnv: RuntimeNodeEnv): string => {
  if (nodeEnv === 'development') {
    return 'debug';
  }

  return 'info';
};

const buildFileTransport = (config: LoggerConfig): transports.FileTransportInstance =>
  new transports.File({
    filename: path.join(config.pathToLogs, `${config.nameApp}.log`),
    maxsize: config.logMaxSizeMb * 1024 * 1024,
    maxFiles: config.logMaxFiles,
    tailable: true,
    format: humanReadableLoggerFormat
  });

const buildTransports = (
  config: LoggerConfig
): Array<transports.ConsoleTransportInstance | transports.FileTransportInstance> => {
  const consoleTransport = new transports.Console({
    format: humanReadableLoggerFormat
  });
  const fileTransport = buildFileTransport(config);

  if (config.nodeEnv === 'development') {
    return [consoleTransport];
  }

  if (config.nodeEnv === 'testing') {
    return [consoleTransport, fileTransport];
  }

  return [fileTransport];
};

const validateLoggerConfig = (config: LoggerConfig): void => {
  const missingKeys: string[] = [];

  if (!config.nodeEnv) {
    missingKeys.push('NODE_ENV');
  }
  if (!config.nameApp || config.nameApp.trim() === '') {
    missingKeys.push('NAME_APP');
  }
  if (!config.pathToLogs || config.pathToLogs.trim() === '') {
    missingKeys.push('PATH_TO_LOGS');
  }

  if (missingKeys.length > 0) {
    throw new Error(`Missing required environment variables: ${missingKeys.join(', ')}`);
  }
};

export const initializeLogger = (config: LoggerConfig): Logger => {
  validateLoggerConfig(config);
  ensureLogDirectory(config.pathToLogs);

  logger.configure({
    level: resolveLogLevel(config.nodeEnv),
    format: humanReadableLoggerFormat,
    transports: buildTransports(config)
  });

  loggerInitialized = true;
  return logger;
};

export const isLoggerInitialized = (): boolean => loggerInitialized;

export const logWorkflowStart = (workflowName: string, metadata?: Record<string, unknown>): void => {
  logger.info('------------------------------------------------------------');
  logger.info(`### Starting ${workflowName} ###`);

  if (metadata && Object.keys(metadata).length > 0) {
    logger.info(`${workflowName} context`, metadata);
  }
};

export default logger;
