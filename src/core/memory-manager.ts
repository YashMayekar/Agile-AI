import path from "path";
import { FileSystem } from "../utils/file-system";
import { logger } from "../utils/logger";

const MODULE = "memory.ts";

export class MemoryManager {
  static loadHistory(projectId: string): Array<{ role: string; content: string }> {
    const historyPath = path.join("projects", projectId, "history.txt");
    try {
      if (!FileSystem.exists(historyPath)) {
        FileSystem.writeFile(historyPath, "");
        return [];
      }
      const content = FileSystem.readFile(historyPath);
      const lines = content.split("\n").filter((line) => line.trim() !== "");
      const history: Array<{ role: string; content: string }> = [];
      for (const line of lines) {  // line is string
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const role = line.slice(0, colonIndex).trim().toLowerCase();
        const text = line.slice(colonIndex + 1).trim();
        if (role === "user" || role === "assistant") {
          history.push({ role, content: text });
        }
      }
      return history;
    } catch (error: any) {
      logger.error(`[${MODULE}] Failed to load history for project ${projectId}: ${error.message}`);
      return [];
    }
  }

  static saveHistory(projectId: string, history: Array<{ role: string; content: string }>): void {
    const historyPath = path.join("projects", projectId, "history.txt");
    const lines = history.map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant";
      return `${label}: ${msg.content}`;
    });
    FileSystem.writeFile(historyPath, lines.join("\n"));
  }

  static addMessage(projectId: string, role: "user" | "assistant", content: string): void {
    const history = this.loadHistory(projectId);
    history.push({ role, content });
    this.saveHistory(projectId, history);
  }

  static getFormattedHistory(projectId: string): string {
    const history = this.loadHistory(projectId);
    if (history.length === 0) return "";
    const lines = history.map((msg) => {
      const label = msg.role === "user" ? "User" : "Assistant";
      return `${label}: ${msg.content}`;
    });
    return lines.join("\n");
  }
}