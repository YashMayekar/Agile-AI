/**
 * Simple in-memory execution lock per project.
 * Prevents race conditions.
 *
 * In production: replace with Redis-based locking.
 */

const activeLocks: Set<string> = new Set();

export class ExecutionLock {

  static acquire(projectId: string) {

    if (activeLocks.has(projectId)) {
      throw new Error("Project is currently being processed. Try again.");
    }

    activeLocks.add(projectId);
  }

  static release(projectId: string) {
    activeLocks.delete(projectId);
  }
}
