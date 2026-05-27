"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryManager = void 0;
const path_1 = __importDefault(require("path"));
const file_system_1 = require("../utils/file-system");
const logger_1 = require("../utils/logger");
const MODULE = "memory.ts";
class MemoryManager {
    static getHistoryPath(projectId) {
        return path_1.default.join("projects", projectId, "history.json");
    }
    static getSummaryPath(projectId) {
        return path_1.default.join("projects", projectId, "history-summary.json");
    }
    static loadSummary(projectId) {
        const summaryPath = this.getSummaryPath(projectId);
        if (!file_system_1.FileSystem.exists(summaryPath)) {
            return { summarizedCount: 0, summaryText: "" };
        }
        try {
            return file_system_1.FileSystem.readJSON(summaryPath);
        }
        catch {
            return { summarizedCount: 0, summaryText: "" };
        }
    }
    // Load full structured history
    static loadHistory(projectId) {
        const historyPath = this.getHistoryPath(projectId);
        try {
            if (!file_system_1.FileSystem.exists(historyPath)) {
                file_system_1.FileSystem.writeJSON(historyPath, []);
                return [];
            }
            return file_system_1.FileSystem.readJSON(historyPath);
        }
        catch (error) {
            logger_1.logger.error(`[${MODULE}] Failed to load history for project ${projectId}: ${error.message}`);
            return [];
        }
    }
    // Save structured history
    static saveHistory(projectId, history) {
        const historyPath = this.getHistoryPath(projectId);
        file_system_1.FileSystem.writeJSON(historyPath, history);
    }
    // Add a full conversation entry (user + assistant)
    static addConversation(projectId, user, ag_res, ag_type) {
        const history = this.loadHistory(projectId);
        const entry = {
            user,
            ag_res,
            ag_type,
            timestamp: Date.now()
        };
        history.push(entry);
        this.saveHistory(projectId, history);
        logger_1.logger.info(`[${MODULE}] Conversation stored successfully`);
        // Async memory summarization
        // this.triggerSummary(projectId).catch(e => logger.error(`[${MODULE}] Async summary failed: ${e}`));
    }
    static async triggerSummary(projectId) {
        const history = this.loadHistory(projectId);
        const summaryPath = this.getSummaryPath(projectId);
        const summaryData = this.loadSummary(projectId);
        // We keep last 2 chats raw. Summarize the rest.
        const totalChatsToSummarize = history.length - 2;
        if (totalChatsToSummarize <= 0)
            return;
        const newChatsToSummarize = totalChatsToSummarize - summaryData.summarizedCount;
        let shouldSummarize = false;
        if (summaryData.summarizedCount === 0 && newChatsToSummarize > 0) {
            shouldSummarize = true;
        }
        else if (summaryData.summarizedCount > 0 && newChatsToSummarize >= 3) {
            shouldSummarize = true;
        }
        if (!shouldSummarize)
            return;
        logger_1.logger.info(`[${MODULE}] Summarizing ${newChatsToSummarize} older chats in the background...`);
        const chatsSubset = history.slice(summaryData.summarizedCount, totalChatsToSummarize);
        const textSubset = chatsSubset.map(e => `[User]: ${e.user}\n[Bot]: ${e.ag_res}`).join('\n\n');
        const prompt = `You are a memory condensation module. Your job is to summarize conversation histories compactly.
Previous Summary:
${summaryData.summaryText || "None"}

New Conversations to Summarize:
${textSubset}

INSTRUCTIONS:
Combine the previous summary with the key points from the new conversations into a single cohesive summary paragraph. Retain critical technical facts, project constraints, identified missing files, and user preferences. Exclude conversational filler. Output ONLY the raw new summary text, no preambles.`;
        logger_1.logger.info(`[${MODULE}] Summarizing older chats in the background...\n${newChatsToSummarize}`);
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
            if (!response.ok)
                throw new Error("Summarizer API failed");
            const data = await response.json();
            summaryData.summaryText = data.response;
            summaryData.summarizedCount = totalChatsToSummarize;
            file_system_1.FileSystem.writeJSON(summaryPath, summaryData);
            logger_1.logger.info(`[${MODULE}] Memory summary updated successfully!`);
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to generate summary: ${e.message}`);
        }
    }
    // 🔥 Return formatted history (user: ... \n assistant: ...)
    static getFormattedHistory(projectId) {
        const history = this.loadHistory(projectId);
        return history
            .map((entry) => {
            return `user: ${entry.user}\nassistant: ${entry.ag_res}`;
        })
            .join("\n");
    }
    // 🧠 Get last N conversations formatted
    static getLastNConversations(projectId, n) {
        const history = this.loadHistory(projectId);
        logger_1.logger.info(`[${MODULE}] Fetching last ${n} conversation history`);
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
    static getLastNConversationsStructured(projectId, n) {
        const history = this.loadHistory(projectId);
        logger_1.logger.info(`[${MODULE}] Fetching last ${n} conversation history (structured)`);
        const slice = history.length <= n ? history : history.slice(-n);
        const structured = [];
        // Inject summary if it exists!
        const summaryData = this.loadSummary(projectId);
        if (summaryData.summaryText) {
            structured.push({ role: "system", content: `SUMMARY OF PAST CONVERSATIONS:\n${summaryData.summaryText}` });
        }
        for (const entry of slice) {
            if (entry.user)
                structured.push({ role: "user", content: entry.user });
            if (entry.ag_res)
                structured.push({ role: "assistant", content: entry.ag_res });
        }
        return structured;
    }
    // ⏱️ Get conversations from last N minutes
    static getLastNMinutes(projectId, minutes) {
        const history = this.loadHistory(projectId);
        const cutoff = Date.now() - minutes * 60 * 1000;
        return history.filter((entry) => entry.timestamp >= cutoff);
    }
    // ⏱️ Get formatted conversations from last N minutes
    static getLastNMinutesFormatted(projectId, minutes) {
        const recent = this.getLastNMinutes(projectId, minutes);
        return recent
            .map((entry) => `user: ${entry.user}\nassistant: ${entry.ag_res}`)
            .join("\n");
    }
}
exports.MemoryManager = MemoryManager;
