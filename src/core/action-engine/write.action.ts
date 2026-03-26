import fs from "fs";
import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";

const MODULE = "write.action.ts";

export class WriteHandler implements ActionHandler {
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
    logger.info(`[${MODULE}] Writing ${safePath}`);
    fs.writeFileSync(safePath, action.content);
    context.sysResults.push({
      type: "WRITE",
      target: action.target,
      content: "SUCCESS",
    });
  }
}