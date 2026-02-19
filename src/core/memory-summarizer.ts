/**
 * Memory Summarizer
 *
 * Responsible for:
 * - Reducing long history
 * - Updating contextMemory.summary
 *
 * Currently simple implementation.
 * Later can call LLM to summarize history intelligently.
 */

import { ProjectState } from "./project-state/project-state.model";

export class MemorySummarizer {

  static summarize(state: ProjectState) {

    const lastFive = state.history.slice(-5);

    const summary = lastFive
      .map(entry => `[${entry.agent}] ${entry.summary}`)
      .join("\n");

    state.contextMemory.summary = summary;

    return state;
  }
}
