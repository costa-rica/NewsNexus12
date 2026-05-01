export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("./lib/logger");

    console.log("Initializing Server-Side Logging...");
    console.log("Environment Debug:", {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_MODE: process.env.NEXT_PUBLIC_MODE,
      NEXT_PUBLIC_PATH_TO_LOGS: process.env.NEXT_PUBLIC_PATH_TO_LOGS,
    });

    const formatArgs = (args: unknown[]) =>
      args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        )
        .join(" ");

    global.console.log = (...args: unknown[]) => {
      logger.info(formatArgs(args));
    };

    global.console.error = (...args: unknown[]) => {
      logger.error(formatArgs(args));
    };

    global.console.warn = (...args: unknown[]) => {
      logger.warn(formatArgs(args));
    };

    global.console.info = (...args: unknown[]) => {
      logger.info(formatArgs(args));
    };

    global.console.debug = (...args: unknown[]) => {
      logger.debug(formatArgs(args));
    };

    logger.info("Logging system initialized via instrumentation hook");
  }
}
