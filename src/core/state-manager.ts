import { ProjectState } from "./project-state/project-state.model";
import { ProjectStateRepository } from "./project-state/project-state.repository";
import { SchemaValidator } from "./schema-validator";
import { logEvent, logger } from "../utils/logger";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";

const MODULE = "state-manager.ts";

export class StateManager {
  static load(projectId: string): ProjectState {
    logger.debug(`[${MODULE}] Loading state for project: ${projectId}`);
    const state = ProjectStateRepository.load(projectId);
    logger.debug(`[${MODULE}] State loaded successfully`);
    return state;
  }

  static save(projectId: string, state: ProjectState) {
    logger.debug(`[${MODULE}] Validating state before save for project ${projectId}`);
    // SchemaValidator.validate("project-state.schema.json", state);
    ProjectStateRepository.save(projectId, state);
    logger.debug(`[${MODULE}] State saved for project ${projectId}`);
  }

  static updateDocument(state: ProjectState, docName: string) {
    const resolvedName = WorkflowEngine.resolvePlaceholders(docName, state);
    logger.debug(`[${MODULE}] Updating document: ${docName} -> resolved: ${resolvedName}`);
    state.documents[resolvedName] = {
      status: "completed",
      version: (state.documents[resolvedName]?.version || 0) + 1,
      updatedAt: new Date().toISOString()
    };
    logEvent("DOCUMENT_UPDATED", { projectId: state.projectId, docName: resolvedName });
    return state;
  }

  static addHistory(
    state: ProjectState,
    stepId: number | string,
    agent: string,
    summary: string
  ) {
    logger.debug(`[${MODULE}] Adding history entry for step ${stepId}, agent ${agent}`);
    state.history.push({
      stepId,
      agent,
      timestamp: new Date().toISOString(),
      summary
    });
    return state;
  }

  static applyAfterStep(
    state: ProjectState,
    step: WorkflowStep,
    agentOutput: any
  ) {
    if (!step.after) {
      logger.debug(`[${MODULE}] No after-step logic for step ${step.id}`);
      return state;
    }

    logger.debug(`[${MODULE}] Applying after-step logic for step ${step.id}`);

    // Example: after step 7 (sharding), populate stories
    if (step.id === 7 && agentOutput.stories) {
      state.dynamicContext.stories = agentOutput.stories;
      state.dynamicContext.currentStoryIndex = 0;
      logger.info(`[${MODULE}] Populated ${agentOutput.stories.length} stories from step 7`);
      logEvent("STORIES_POPULATED", {
        projectId: state.projectId,
        count: agentOutput.stories.length
      });
    }

    // Example: after step 11 (QA), set qaLeftUnchecked
    if (step.id === 11 && agentOutput.qaLeftUnchecked !== undefined) {
      state.dynamicContext.qaLeftUnchecked = agentOutput.qaLeftUnchecked;
      logger.debug(`[${MODULE}] QA left unchecked set to ${agentOutput.qaLeftUnchecked}`);
    }

    return state;
  }

  static markStepCompleted(state: ProjectState, stepId: number | string) {
    if (!state.completedSteps.includes(stepId)) {
      state.completedSteps.push(stepId);
      logger.debug(`[${MODULE}] Step ${stepId} marked as completed`);
    } else {
      logger.debug(`[${MODULE}] Step ${stepId} already completed, skipping`);
    }
    return state;
  }
}