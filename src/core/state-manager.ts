import { ProjectState } from "./project-state/project-state.model";
import { ProjectStateRepository } from "./project-state/project-state.repository";
import { SchemaValidator } from "./schema-validator";
import { logEvent, logger } from "../utils/logger";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";
import path from "path/win32";
import { promises as fs } from "fs";


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

  static async addHistory(
  projectid: string,
  state: ProjectState,
  stepId: number | string,
  agent: string,
  summary: string
) {
  const filePath = path.join(projectid, "history.txt");

  try {
    // Read existing file
    let data;
    try {
      const fileContent = await fs.readFile(filePath, "utf8");
      data = JSON.parse(fileContent);
    } catch (err) {
      // If file doesn't exist or is empty
      data = { History: [] };
    }

    // Ensure structure exists
    if (!data.History) {
      data.History = [];
    }

    // Append new history
    data.History.push({
      stepId,
      agent,
      timestamp: new Date().toISOString(),
      summary
    });

    // Write back to file
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");

  } catch (error) {
    console.error("Error updating history:", error);
    throw error;
  }

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