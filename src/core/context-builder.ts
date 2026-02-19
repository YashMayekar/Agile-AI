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

export class ContextBuilder {

  /**
   * Builds structured context object for agents.
   */
  static build(state: ProjectState, currentStep: any, userInput: string) {

    return {
      projectId: state.projectId,
      phase: state.phase,
      stepId: state.currentStepId,
      stepName: currentStep.name,
      documents: state.documents,
      projectSummary: state.contextMemory.summary,
      decisions: state.contextMemory.decisions,
      architectureNotes: state.contextMemory.architectureNotes,
      userInput
    };
  }
}
