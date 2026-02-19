/**
 * Base Agent
 *
 * All agents (PM, Analyst, Developer, etc.) extend this.
 * Each agent defines:
 * - Role
 * - System prompt
 * - Prompt construction logic
 */

import { LLMAdapter } from "../llm/llm-adapter.interface";

export abstract class BaseAgent {

  protected llm: LLMAdapter;

  constructor(llm: LLMAdapter) {
    this.llm = llm;
  }

  /**
   * Defines the role and behavior of the agent.
   */
  abstract getSystemPrompt(): string;

  /**
   * Builds final user prompt.
   * Combines:
   * - Project state summary
   * - Current step
   * - Relevant documents
   * - User input
   */
  abstract buildUserPrompt(context: any): string;

  /**
   * Executes agent with structured context.
   */
  async execute(context: any) {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildUserPrompt(context);

    return this.llm.generate({
      systemPrompt,
      userPrompt,
    });
  }
}
