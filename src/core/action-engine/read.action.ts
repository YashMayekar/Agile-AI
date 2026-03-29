import fs from "fs";
import { logger } from "../../utils/logger";
import { Action, ActionHandler, BaseActionEngine } from "./base-engine";

const MODULE = "read.action.ts";

export class ReadHandler implements ActionHandler, BaseActionEngine {
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
    logger.info(`[${MODULE}] Reading ${safePath}`);

    let content: string;
    try {
      if (!fs.existsSync(safePath)) {
        content = "FILE_NOT_FOUND";
        logger.warn(`[${MODULE}] FILE_NOT_FOUND for ${safePath}`)
      } else {
        content = fs.readFileSync(safePath, "utf-8");
      }
    } catch (e) {
      content = "READ_ERROR";
      logger.error(`[${MODULE}] READ_ERROR for ${safePath}`)
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

  }
}