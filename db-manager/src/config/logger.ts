import fs from "fs";
import path from "path";
import winston from "winston";

const nodeEnv = process.env.NODE_ENV || process.env.NEXT_PUBLIC_MODE;
const appName = process.env.NAME_APP;
const logsPath = process.env.PATH_TO_LOGS;

const missingVars: string[] = [];

if (!nodeEnv) missingVars.push("NODE_ENV");
if (!appName) missingVars.push("NAME_APP");
if (!logsPath) missingVars.push("PATH_TO_LOGS");

if (missingVars.length > 0) {
  process.stderr.write(
    `Missing required environment variables: ${missingVars.join(", ")}\n`,
  );
  process.exit(1);
}

const normalizedEnv = nodeEnv as string;
const allowedEnvs = ["development", "testing", "production"];

if (!allowedEnvs.includes(normalizedEnv)) {
  process.stderr.write(
    `Invalid NODE_ENV value: ${normalizedEnv}. Expected development, testing, or production.\n`,
  );
  process.exit(1);
}

const resolvedLogsPath = path.resolve(logsPath as string);

if (!fs.existsSync(resolvedLogsPath)) {
  fs.mkdirSync(resolvedLogsPath, { recursive: true });
}

const logMaxSizeMb = Number.parseInt(process.env.LOG_MAX_SIZE ?? "5", 10);
const logMaxFiles = Number.parseInt(process.env.LOG_MAX_FILES ?? "5", 10);
const maxSizeBytes = logMaxSizeMb * 1024 * 1024;

const logLevel = normalizedEnv === "development" ? "debug" : "info";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level}] ${message}${metaString}`;
  }),
);

const transports: winston.transport[] = [];

if (normalizedEnv !== "production") {
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.printf(({ level, message, timestamp, ...meta }) => {
          const metaString = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";
          return `${timestamp} ${level}: ${message}${metaString}`;
        }),
      ),
    }),
  );
}

if (normalizedEnv !== "development") {
  transports.push(
    new winston.transports.File({
      filename: path.join(resolvedLogsPath, `${appName}.log`),
      level: logLevel,
      maxsize: Number.isFinite(maxSizeBytes) ? maxSizeBytes : 5 * 1024 * 1024,
      maxFiles: Number.isFinite(logMaxFiles) ? logMaxFiles : 5,
      format: logFormat,
    }),
  );
}

export const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports,
});
