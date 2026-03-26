import path from "path";
import { FileSystem } from "../utils/file-system";
import { logger } from "../utils/logger";
import { ChatHistoryEntry } from "../core/project-state/project-state.model";

const MODULE = "memory.ts";

export class MemoryManager {
  private static getHistoryPath(projectId: string): string {
    return path.join("projects", projectId, "history.json");
  }

  // Load full structured history
  static loadHistory(projectId: string): ChatHistoryEntry[] {
    const historyPath = this.getHistoryPath(projectId);

    try {
      if (!FileSystem.exists(historyPath)) {
        FileSystem.writeJSON(historyPath, []);
        return [];
      }

      return FileSystem.readJSON(historyPath) as ChatHistoryEntry[];
    } catch (error: any) {
      logger.error(`[${MODULE}] Failed to load history for project ${projectId}: ${error.message}`);
      return [];
    }
  }

  // Save structured history
  static saveHistory(projectId: string, history: ChatHistoryEntry[]): void {
    const historyPath = this.getHistoryPath(projectId);
    FileSystem.writeJSON(historyPath, history);
  }

  // Add a full conversation entry (user + assistant)
  static addConversation(
    projectId: string,
    user: string,
    ag_res: string,
    ag_type: string
  ): void {
    const history = this.loadHistory(projectId);

    const entry: ChatHistoryEntry = {
      user,
      ag_res,
      ag_type,
      timestamp: Date.now()
    };

    history.push(entry);
    this.saveHistory(projectId, history);
    logger.info(`[${MODULE}] Conversation stored successfully`)
  }

  // 🔥 Return formatted history (user: ... \n assistant: ...)
  static getFormattedHistory(projectId: string): string {
    const history = this.loadHistory(projectId);

    return history
      .map((entry) => {
        return `user: ${entry.user}\nassistant: ${entry.ag_res}`;
      })
      .join("\n");
  }

    // 🧠 Get last N conversations formatted
  static getLastNConversations(projectId: string, n: number): string {
    const history = this.loadHistory(projectId);
    logger.info(`[${MODULE}] Fetching last ${n} conversation history`)
    if (history.length<=n){ 
      return history
      .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
      .join("\n");
    }
    return history.slice(-n)
      .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
      .join("\n");
  }

  // ⏱️ Get conversations from last N minutes
  static getLastNMinutes(projectId: string, minutes: number): ChatHistoryEntry[] {
    const history = this.loadHistory(projectId);
    const cutoff = Date.now() - minutes * 60 * 1000;

    return history.filter((entry) => entry.timestamp >= cutoff);
  }

  // ⏱️ Get formatted conversations from last N minutes
  static getLastNMinutesFormatted(projectId: string, minutes: number): string {
    const recent = this.getLastNMinutes(projectId, minutes);

    return recent
      .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
      .join("\n");
  }
}