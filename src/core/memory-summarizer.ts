/**
 * Memory Summarizer
 *
 * Responsible for:
 * - Reducing long history intelligently using LLM
 * - Updating contextMemory.summary, decisions, and architectureNotes
 *
 * Falls back to simple last‑5 summary if LLM is not provided or fails.
 */

import { ProjectState } from "./project-state/project-state.model";
import { logger } from "../utils/logger";
import { LLMAdapter } from "../llm/llm-adapter.interface"; // use interface, not concrete class

const MODULE = "memory-summarizer.ts";
const SUMMARY_THRESHOLD = 10; // use LLM when history length > this

export class MemorySummarizer {
  /**
   * Summarize project history.
   * If llm is provided and history is long enough, use LLM to generate a smart summary.
   * Otherwise, fall back to simple concatenation of last 5 entries.
   */
  static async summarize(state: ProjectState, llm?: LLMAdapter): Promise<ProjectState> {
    logger.debug(`[${MODULE}] Summarizing memory for project ${state.projectId}`);

    const historyLength = state.history.length;

    // Use LLM if available and history is long enough
    if (llm && historyLength > SUMMARY_THRESHOLD) {
      try {
        const llmSummary = await this.summarizeWithLLM(state, llm);
        state.contextMemory.summary = llmSummary.summary;
        // Merge decisions and architectureNotes (avoid duplicates)
        if (llmSummary.decisions) {
          state.contextMemory.decisions = [
            ...new Set([...state.contextMemory.decisions, ...llmSummary.decisions])
          ];
        }
        if (llmSummary.architectureNotes) {
          state.contextMemory.architectureNotes = [
            ...new Set([...state.contextMemory.architectureNotes, ...llmSummary.architectureNotes])
          ];
        }
        logger.info(`[${MODULE}] LLM summary generated successfully.`);
        return state;
      } catch (error: any) {
        logger.warn(`[${MODULE}] LLM summarization failed, falling back to simple method. Error: ${error.message}`);
        // Fall through to simple method
      }
    }

    // Simple fallback: concatenate last 5 entries
    const lastFive = state.history.slice(-5);
    const summary = lastFive
      .map(entry => `[${entry.agent}] ${entry.summary}`)
      .join("\n");

    state.contextMemory.summary = summary;
    logger.debug(`[${MODULE}] Simple summary updated: ${summary.substring(0, 100)}...`);
    return state;
  }

  /**
   * Call LLM to generate a structured summary from the entire history.
   * Expects LLM to return JSON with fields: summary (string), decisions (string[]), architectureNotes (string[]).
   */
  private static async summarizeWithLLM(
    state: ProjectState,
    llm: LLMAdapter
  ): Promise<{ summary: string; decisions: string[]; architectureNotes: string[] }> {
    // Build prompt with full history
    const historyText = state.history
      .map(h => `Step ${h.stepId} (${h.agent} at ${h.timestamp}): ${h.summary}`)
      .join("\n");

    const systemPrompt = `You are an AI project memory summarizer. Given the project history below, produce a concise summary that captures the current state, key decisions made, and any architecture notes that are still relevant.

Return a valid JSON object with the following fields:
- "summary": a paragraph summarizing the current project status and what has been accomplished.
- "decisions": an array of strings, each a key decision made so far.
- "architectureNotes": an array of strings, each an important architectural detail or note.`;

    const userPrompt = `Project History:\n${historyText}\n\nJSON Response:`;

    const response = await llm.generate({
      systemPrompt,
      userPrompt,
    });

    // The generate method returns an object with a 'raw' property (the LLM output string)
    // Based on BaseAgent's execute, we expect response.raw to be the raw text.
    const rawText = response.raw;

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to parse LLM summary JSON: ${e.message}`);
      throw new Error("LLM summary JSON parse failed");
    }

    // Validate expected fields
    const summary = parsed.summary || "";
    const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
    const architectureNotes = Array.isArray(parsed.architectureNotes) ? parsed.architectureNotes : [];

    return { summary, decisions, architectureNotes };
  }
}