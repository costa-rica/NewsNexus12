import "server-only";
import winston from "winston";
import "winston-daily-rotate-file";
import path from "path";

// Environment detection
// Priority: NEXT_PUBLIC_MODE -> NODE_ENV -> default 'development'
const environment =
  process.env.NEXT_PUBLIC_MODE || process.env.NODE_ENV || "development";
const isProduction = environment === "production";

const appName =
  process.env.NEXT_PUBLIC_NAME_APP ||
  process.env.NAME_APP ||
  "NewsNexus12Portal";
const logDir =
  process.env.NEXT_PUBLIC_PATH_TO_LOGS || process.env.PATH_TO_LOGS || "./logs";
const maxSize = process.env.LOG_MAX_SIZE
  ? parseInt(process.env.LOG_MAX_SIZE)
  : 10 * 1024 * 1024; // 10MB
const maxFiles = process.env.LOG_MAX_FILES
  ? parseInt(process.env.LOG_MAX_FILES)
  : 10;

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${appName}] ${message}${metaStr}`;
  }),
);

// Create logger instance
const logger = winston.createLogger({
  level: isProduction ? "info" : "debug",
  format: logFormat,
  transports: [],
});

// Configure transports based on environment
if (isProduction) {
  // Production: Write to rotating files
  // Ensure we are in a server context before trying to write files
  if (typeof window === "undefined") {
    try {
      logger.add(
        new winston.transports.File({
          filename: path.join(logDir, `${appName}.log`),
          maxsize: maxSize,
          maxFiles: maxFiles,
          tailable: true,
          handleExceptions: true,
        }),
      );
    } catch (error) {
      console.error("Failed to initialize file transport for logger:", error);
      // Fallback to console in case of file system errors
      logger.add(
        new winston.transports.Console({
          format: winston.format.simple(),
        }),
      );
    }
  }
} else {
  // Development: Console output with colors
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? " " + JSON.stringify(meta)
            : "";
          // Simulating the requested dev format: TIME LEVEL [APP] Message
          const time = new Date().toLocaleTimeString("en-US", {
            hour12: false,
          });
          return `${time} ${level} [${appName}] ${message}${metaStr}`;
        }),
      ),
    }),
  );
}

export { logger };
