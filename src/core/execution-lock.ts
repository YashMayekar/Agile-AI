import { logger } from "../utils/logger";
/**
 * Simple in-memory execution lock per project.
 * Prevents race conditions.
 *
 * In production: replace with Redis-based locking.
 */
const MODULE = "execution-lock.ts"

const activeLocks: Set<string> = new Set();

export class ExecutionLock {

  static acquire(projectId: string) {
    if (activeLocks.has(projectId)) {
      logger.warn(`[${MODULE}] The project: ${projectId} is being processed.`)
      throw new Error("Project is currently being processed. Try again.");
    }

    activeLocks.add(projectId);
  }

  static release(projectId: string) {
    activeLocks.delete(projectId);
  }
}
