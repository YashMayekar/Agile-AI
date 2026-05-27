import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";
import { ProjectStateRepository } from "../project-state/project-state.repository";
import { WorkflowEngine } from "../workflow-engine";


const MODULE = "workflow.action.ts";

export class WorkflowHandler implements ActionHandler {
  execute(
    projectId: string,
    safePath: string,
    action: Action,
    context: {
      aggregatedReadResults: { target: string; content: string }[];
      sysResults: Action[];
      cliActions: Action[];
    },
    signal?: AbortSignal
  ): void {
    logger.info(`[${MODULE}] Executing workflow action ${action.target} for ${projectId}`);

    let state: any;
    try {
      state = ProjectStateRepository.load(projectId) ||{};
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to load project state: ${e?.message || e}`);
      context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "WORFLOW_LOAD_ERROR" });
      return;
    }

    let current = 0;
    if (state.currentStepId !== null && state.currentStepId !== undefined && state.currentStepId !== "") {
      const parsed = Number(state.currentStepId);
      current = Number.isNaN(parsed) ? 0 : parsed;
    }

    let newStep = current;
    if (action.target === "NEXT-STEP") {
      newStep = current + 1;
    } else {
      const parsedTarget = Number(action.target);
      if (!Number.isNaN(parsedTarget)) {
        newStep = parsedTarget;
      } else {
        logger.warn(`[${MODULE}] Invalid workflow target: ${action.target}`);
        context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "INVALID_TARGET" });
        return;
      }
    }
   
    state.currentStepId = String(newStep);

    state.currentAgent = WorkflowEngine.getStepById(newStep).agent

    state.systemStatus = WorkflowEngine.getStepById(newStep) ? `Moved to step ${newStep}: ${WorkflowEngine.getStepById(newStep).name}` : "Executing step";

    state.currentStepName = WorkflowEngine.getStepById(newStep).name;

    try {
      ProjectStateRepository.save(projectId, state);
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to save project state: ${e?.message || e}`);
      context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "SAVE_ERROR" });
      return;
    }

    context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "SUCCESS" });
  }
}
