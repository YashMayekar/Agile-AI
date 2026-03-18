/**
 * Context Builder
 *
 * Responsible for:
 * - Preparing structured context for agents
 * - Extracting relevant documents
 * - Adding summarized memory
 * - Keeping prompts clean and minimal
 */

import { ProjectState } from "./project-state/project-state.model";
import { WorkflowStep } from "./workflow-engine";
import { logger } from "../utils/logger";

const MODULE = "context-builder.ts";

export class ContextBuilder {

  /**
   * Builds structured context object for agents.
   */
  static build(state: ProjectState, currentStep: WorkflowStep, userInput: string) {
  logger.debug(`[${MODULE}] Building context for step ${currentStep.id}, project ${state.projectId}`);

  const context = {
    projectId: state.projectId,
    mode: state.mode,
    phase: state.phase,
    stepId: state.currentStepId,
    stepName: currentStep.name,
    stepAgent: currentStep.agent,
    documents: state.documents,
    projectSummary: state.contextMemory?.summary || "",
    decisions: state.contextMemory?.decisions || [],
    architectureNotes: state.contextMemory?.architectureNotes || [],
    dynamicContext: state.dynamicContext || { stories: [], currentStoryIndex: 0, qaLeftUnchecked: false },
    fileTree: state.dynamicContext?.fileTree, // expose tree to agent
    userInput
  };

  logger.debug(`[${MODULE}] Context built`);
  return context;
}
}