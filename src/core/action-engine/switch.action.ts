import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";
import { ProjectStateRepository } from "../project-state/project-state.repository";

const MODULE = "switch.action.ts";

export class SwitchHandler implements ActionHandler {
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

    let state: any;
    try {
      state = ProjectStateRepository.load(projectId) || {};
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to load project state: ${e?.message || e}`);
      context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "WORFLOW_LOAD_ERROR" });
      return;
    }
    
    logger.info(`[${MODULE}] SWITCH-AG action ignored`);
  }
}