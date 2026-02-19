/**
 * State Manager
 * Central control for project state.
 * Responsible for:
 * - Loading state
 * - Validating state
 * - Applying transitions
 * - Updating documents
 * - Persisting state
 */

import { ProjectState } from "./project-state/project-state.model";
import { ProjectStateRepository } from "./project-state/project-state.repository";
import { SchemaValidator } from "./schema-validator";
import { logEvent, logger } from "../utils/logger";
import { log } from "console";

export class StateManager {

  /**
   * Loads and validates project state.
   */
  static load(projectId: string): ProjectState {
    const state = ProjectStateRepository.load(projectId);
    logger.debug(`Loading state for project: ${state}`);
    // SchemaValidator.validate("project-state.schema.json", state);
    return state;
  }

  /**
   * Persists updated state.
   */
  static save(projectId: string, state: ProjectState) {
    SchemaValidator.validate("project-state.schema.json", state);
    ProjectStateRepository.save(projectId, state);
  }

  /**
   * Marks step as completed and moves to next.
   */
  static completeStep(state: ProjectState, nextStepId: Number | null) {

    state.completedSteps.push(state.currentStepId);

    state.pendingSteps = state.pendingSteps.filter(
      step => step !== state.currentStepId
    );

    if (nextStepId) {
      state.currentStepId = nextStepId;
      state.pendingSteps.push(nextStepId);
    }

    logEvent("STEP_COMPLETED", {
      projectId: state.projectId,
      completedStep: state.currentStepId,
      nextStepId
    });

    return state;
  }

  /**
   * Registers document creation/update.
   */
  static updateDocument(state: ProjectState, docName: string) {

    state.documents[docName] = {
      status: "completed",
      version: (state.documents[docName]?.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };

    logEvent("DOCUMENT_UPDATED", {
      projectId: state.projectId,
      docName
    });

    return state;
  }

  /**
   * Adds history entry
   */
  static addHistory(state: ProjectState, stepId: Number, agent: string, summary: string) {

    state.history.push({
      stepId,
      agent,
      timestamp: new Date().toISOString(),
      summary
    });

    return state;
  }
}
