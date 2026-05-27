"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionLock = void 0;
const logger_1 = require("../utils/logger");
/**
 * Simple in-memory execution lock per project.
 * Prevents race conditions.
 *
 * In production: replace with Redis-based locking.
 */
const MODULE = "execution-lock.ts";
const activeLocks = new Set();
class ExecutionLock {
    static acquire(projectId) {
        if (activeLocks.has(projectId)) {
            logger_1.logger.warn(`[${MODULE}] The project: ${projectId} is being processed.`);
            throw new Error("Project is currently being processed. Try again.");
        }
        activeLocks.add(projectId);
    }
    static release(projectId) {
        activeLocks.delete(projectId);
    }
}
exports.ExecutionLock = ExecutionLock;
