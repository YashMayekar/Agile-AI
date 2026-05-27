/**
 * Centralized structured logging system with automatic project context propagation.
 *
 * Features:
 * - Automatically attaches projectId to every log
 * - Stores logs inside:
 *      /projects/<projectId>/system.log
 * - Works across deeply nested async calls
 * - Human-readable console logs
 * - Structured JSON file logs
 */

import winston from "winston";
import path from "path";
import fs from "fs";
import { AsyncLocalStorage } from "async_hooks";

/* =========================================================
   CONTEXT STORAGE
========================================================= */

type LogContext = {
  projectId?: string;
};

export const logContext = new AsyncLocalStorage<LogContext>();

/* =========================================================
   ENSURE PROJECT LOG DIRECTORY EXISTS
========================================================= */

function ensureProjectLogDir(projectId: string) {
  const logDir = path.join(process.cwd(), "projects", projectId);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return logDir;
}

/* =========================================================
   CUSTOM FORMATTER TO INJECT PROJECT ID
========================================================= */

const injectContextFormat = winston.format((info) => {
  const store = logContext.getStore();

  if (store?.projectId) {
    info.projectId = store.projectId;
  }

  return info;
});

/* =========================================================
   CONSOLE FORMATTER
========================================================= */

const consoleTimestampFormat = winston.format.printf(
  ({ level, message, timestamp, projectId, ...metadata }) => {

    let logMessage = "";


    // Add message
    logMessage += message;

    // Clean metadata
    const cleanMetadata = { ...metadata };

    delete cleanMetadata.level;
    delete cleanMetadata.message;
    delete cleanMetadata.timestamp;
    delete cleanMetadata.projectId;

    // Append metadata
    if (Object.keys(cleanMetadata).length > 0) {
      logMessage += ` ${JSON.stringify(cleanMetadata)}`;
    }

    return `${timestamp} ${level} ${logMessage}`;
  }
);

/* =========================================================
   LOGGER CACHE
   One logger per project
========================================================= */

const loggerCache = new Map<string, winston.Logger>();

/* =========================================================
   CREATE PROJECT LOGGER
========================================================= */

function createProjectLogger(projectId: string) {

  const logDir = ensureProjectLogDir(projectId);

  return winston.createLogger({
    level: "debug",

    format: winston.format.combine(
      injectContextFormat(),
      winston.format.timestamp()
    ),

    transports: [

      /**
       * FILE LOGGER
       * Structured JSON logs
       */
      new winston.transports.File({
        filename: path.join(logDir, "system.log"),

        level: "info",

        format: winston.format.combine(
          injectContextFormat(),
          winston.format.timestamp(),
          winston.format.json()
        )
      }),

      /**
       * CONSOLE LOGGER
       * Human readable logs
       */
      new winston.transports.Console({
        format: winston.format.combine(
          injectContextFormat(),
          winston.format.colorize({ all: true }),
          winston.format.timestamp({
            format: "HH:mm:ss"
          }),
          consoleTimestampFormat
        )
      })
    ]
  });
}

/* =========================================================
   GET LOGGER FOR CURRENT CONTEXT
========================================================= */

function getCurrentLogger(): winston.Logger {

  const store = logContext.getStore();

  const projectId = store?.projectId || "global";

  if (!loggerCache.has(projectId)) {

    const logger = createProjectLogger(projectId);

    loggerCache.set(projectId, logger);
  }

  return loggerCache.get(projectId)!;
}

/* =========================================================
   EXPORTED LOGGER API
========================================================= */

export const logger = {
  info: (message: string, meta?: Record<string, any>) => {
    getCurrentLogger().info(message, meta);
  },

  error: (message: string, meta?: Record<string, any>) => {
    getCurrentLogger().error(message, meta);
  },

  warn: (message: string, meta?: Record<string, any>) => {
    getCurrentLogger().warn(message, meta);
  },

  debug: (message: string, meta?: Record<string, any>) => {
    getCurrentLogger().debug(message, meta);
  }
};

/* =========================================================
   HELPER TO RUN WITH PROJECT CONTEXT
========================================================= */

export async function withProjectLogging<T>(
  projectId: string,
  fn: () => Promise<T>
): Promise<T> {

  return logContext.run({ projectId }, async () => {
    return fn();
  });
}