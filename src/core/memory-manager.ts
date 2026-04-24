import path from "path";
import { FileSystem } from "../utils/file-system";
import { logger } from "../utils/logger";
import { ChatHistoryEntry } from "../core/project-state/project-state.model";

const MODULE = "memory.ts";

export class MemoryManager {
  private static getHistoryPath(projectId: string): string {
    return path.join("projects", projectId, "history.json");
  }

  private static getSummaryPath(projectId: string): string {
    return path.join("projects", projectId, "history-summary.json");
  }

  private static loadSummary(projectId: string): { summarizedCount: number; summaryText: string } {
    const summaryPath = this.getSummaryPath(projectId);
    if (!FileSystem.exists(summaryPath)) {
      return { summarizedCount: 0, summaryText: "" };
    }
    try {
      return FileSystem.readJSON(summaryPath) as { summarizedCount: number; summaryText: string };
    } catch {
      return { summarizedCount: 0, summaryText: "" };
    }
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
    logger.info(`[${MODULE}] Conversation stored successfully`);

    // Async memory summarization
    // this.triggerSummary(projectId).catch(e => logger.error(`[${MODULE}] Async summary failed: ${e}`));
  }

  private static async triggerSummary(projectId: string) {
    const history = this.loadHistory(projectId);
    const summaryPath = this.getSummaryPath(projectId);
    const summaryData = this.loadSummary(projectId);

    // We keep last 2 chats raw. Summarize the rest.
    const totalChatsToSummarize = history.length - 2;
    if (totalChatsToSummarize <= 0) return;

    const newChatsToSummarize = totalChatsToSummarize - summaryData.summarizedCount;

    let shouldSummarize = false;
    if (summaryData.summarizedCount === 0 && newChatsToSummarize > 0) {
      shouldSummarize = true;
    } else if (summaryData.summarizedCount > 0 && newChatsToSummarize >= 3) {
      shouldSummarize = true;
    }

    if (!shouldSummarize) return;

    logger.info(`[${MODULE}] Summarizing ${newChatsToSummarize} older chats in the background...`);

    const chatsSubset = history.slice(summaryData.summarizedCount, totalChatsToSummarize);
    const textSubset = chatsSubset.map(e => `[User]: ${e.user}\n[Bot]: ${e.ag_res}`).join('\n\n');

    const prompt = `You are a memory condensation module. Your job is to summarize conversation histories compactly.
Previous Summary:
${summaryData.summaryText || "None"}

New Conversations to Summarize:
${textSubset}

INSTRUCTIONS:
Combine the previous summary with the key points from the new conversations into a single cohesive summary paragraph. Retain critical technical facts, project constraints, identified missing files, and user preferences. Exclude conversational filler. Output ONLY the raw new summary text, no preambles.`;

    logger.info(`[${MODULE}] Summarizing older chats in the background...\n${newChatsToSummarize}`);
    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gemma4:e4b", // using main model for good summary capability
          prompt: prompt,
          stream: false,
          thinking: false,
        })
      });

      if (!response.ok) throw new Error("Summarizer API failed");
      const data = await response.json();

      summaryData.summaryText = data.response;
      summaryData.summarizedCount = totalChatsToSummarize;

      FileSystem.writeJSON(summaryPath, summaryData);
      logger.info(`[${MODULE}] Memory summary updated successfully!`);
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to generate summary: ${e.message}`);
    }
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
    if (history.length <= n) {
      return history
        .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
        .join("\n");
    }
    return history.slice(-n)
      .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
      .join("\n");
  }

  // 🧠 Get last N conversations structured
  static getLastNConversationsStructured(projectId: string, n: number): { role: string, content: string }[] {
    const history = this.loadHistory(projectId);
    logger.info(`[${MODULE}] Fetching last ${n} conversation history (structured)`);

    const slice = history.length <= n ? history : history.slice(-n);
    const structured: { role: string, content: string }[] = [];

    // Inject summary if it exists!
    const summaryData = this.loadSummary(projectId);
    if (summaryData.summaryText) {
      structured.push({ role: "system", content: `SUMMARY OF PAST CONVERSATIONS:\n${summaryData.summaryText}` });
    }

    for (const entry of slice) {
      if (entry.user) structured.push({ role: "user", content: entry.user });
      if (entry.ag_res) structured.push({ role: "assistant", content: entry.ag_res });
    }

    return structured;
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