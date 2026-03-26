import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";

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
    }
  ): void {
    // This action type is a no‑op in the engine
    logger.info(`[${MODULE}] SWITCH-AG action ignored`);
  }
}