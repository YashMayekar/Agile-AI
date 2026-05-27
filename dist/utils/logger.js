"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.logContext = void 0;
exports.withProjectLogging = withProjectLogging;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const async_hooks_1 = require("async_hooks");
exports.logContext = new async_hooks_1.AsyncLocalStorage();
/* =========================================================
   ENSURE PROJECT LOG DIRECTORY EXISTS
========================================================= */
function ensureProjectLogDir(projectId) {
    const logDir = path_1.default.join(process.cwd(), "projects", projectId);
    if (!fs_1.default.existsSync(logDir)) {
        fs_1.default.mkdirSync(logDir, { recursive: true });
    }
    return logDir;
}
/* =========================================================
   CUSTOM FORMATTER TO INJECT PROJECT ID
========================================================= */
const injectContextFormat = winston_1.default.format((info) => {
    const store = exports.logContext.getStore();
    if (store?.projectId) {
        info.projectId = store.projectId;
    }
    return info;
});
/* =========================================================
   CONSOLE FORMATTER
========================================================= */
const consoleTimestampFormat = winston_1.default.format.printf(({ level, message, timestamp, projectId, ...metadata }) => {
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
});
/* =========================================================
   LOGGER CACHE
   One logger per project
========================================================= */
const loggerCache = new Map();
/* =========================================================
   CREATE PROJECT LOGGER
========================================================= */
function createProjectLogger(projectId) {
    const logDir = ensureProjectLogDir(projectId);
    return winston_1.default.createLogger({
        level: "debug",
        format: winston_1.default.format.combine(injectContextFormat(), winston_1.default.format.timestamp()),
        transports: [
            /**
             * FILE LOGGER
             * Structured JSON logs
             */
            new winston_1.default.transports.File({
                filename: path_1.default.join(logDir, "system.log"),
                level: "info",
                format: winston_1.default.format.combine(injectContextFormat(), winston_1.default.format.timestamp(), winston_1.default.format.json())
            }),
            /**
             * CONSOLE LOGGER
             * Human readable logs
             */
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(injectContextFormat(), winston_1.default.format.colorize({ all: true }), winston_1.default.format.timestamp({
                    format: "HH:mm:ss"
                }), consoleTimestampFormat)
            })
        ]
    });
}
/* =========================================================
   GET LOGGER FOR CURRENT CONTEXT
========================================================= */
function getCurrentLogger() {
    const store = exports.logContext.getStore();
    const projectId = store?.projectId || "global";
    if (!loggerCache.has(projectId)) {
        const logger = createProjectLogger(projectId);
        loggerCache.set(projectId, logger);
    }
    return loggerCache.get(projectId);
}
/* =========================================================
   EXPORTED LOGGER API
========================================================= */
exports.logger = {
    info: (message, meta) => {
        getCurrentLogger().info(message, meta);
    },
    error: (message, meta) => {
        getCurrentLogger().error(message, meta);
    },
    warn: (message, meta) => {
        getCurrentLogger().warn(message, meta);
    },
    debug: (message, meta) => {
        getCurrentLogger().debug(message, meta);
    }
};
/* =========================================================
   HELPER TO RUN WITH PROJECT CONTEXT
========================================================= */
async function withProjectLogging(projectId, fn) {
    return exports.logContext.run({ projectId }, async () => {
        return fn();
    });
}
