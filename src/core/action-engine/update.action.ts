import fs from "fs";
import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";

const MODULE = "update.action.ts";

export class UpdateHandler implements ActionHandler {
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
    
    logger.info(`[${MODULE}] UPDATE intercepted → forcing READ first`);

    let content: string;
    try {
      if (!fs.existsSync(safePath)) {
        content = "FILE_NOT_FOUND";
      } else {
        content = fs.readFileSync(safePath, "utf-8");
      }
    } catch (e) {
      content = "READ_ERROR";
    }

    context.aggregatedReadResults.push({
      target: action.target,
      content,
    });

    context.sysResults.push({
      type: "READ",
      target: action.target,
      content,
    });

    // ❗ No write performed – LLM will decide the actual update later
  }
}