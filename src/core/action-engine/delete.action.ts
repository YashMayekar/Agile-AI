import fs from "fs";
import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";



const MODULE = "delete.action.ts";

export class DeleteHandler implements ActionHandler {
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
    
    logger.info(`[${MODULE}] Deleting ${safePath}`);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
    context.sysResults.push({
      type: "DELETE",
      target: action.target,
      content: "SUCCESS",
    });
  }
}