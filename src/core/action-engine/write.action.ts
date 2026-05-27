import fs from "fs";
import { logger } from "../../utils/logger";
import { Action, ActionHandler } from "./base-engine";
import { ProjectStateRepository } from "../project-state/project-state.repository";
import { OllamaAdapter } from "../../llm/ollama.adapter";
import { systemStatuses } from "../../api/project.controller";

const MODULE = "write.action.ts";

export class WriteHandler implements ActionHandler {
  async execute(
    projectId: string,
    safePath: string,
    action: Action,
    context: {
      aggregatedReadResults: { target: string; content: string }[];
      sysResults: Action[];
      cliActions: Action[];
    },
    signal?: AbortSignal
  ): Promise<void> {
    logger.info(`[${MODULE}] Writing ${safePath}`);

    let state: any;
    try {
      // Ensure the directory exists
      const dir = require("path").dirname(safePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info(`[${MODULE}] Created directory ${dir}`);
      }
      fs.writeFileSync(safePath, action.content);
      systemStatuses.set(projectId, { object: "", message: "WRITE_SUCCESS: " + safePath });
      state = ProjectStateRepository.load(projectId) || {};
      // get filename
      const filename = safePath.split('\\').pop() || "";
      const new_version = state.documents[filename] ? state.documents[filename].version + 1 : 1;
      state.documents[filename] = { status: "completed", version: new_version, updatedAt: new Date().toISOString() }  ;
      ProjectStateRepository.save(projectId, state);
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to write file ${safePath}: ${e?.message || e}`);
      context.sysResults.push({ type: "WRITE", target: action.target, content: "WRITE_ERROR" });
      systemStatuses.set(projectId, { object: "", message: "WRITE_ERROR: " + e?.message || e });
      return;
    }

    let resultContent = "SUCCESS";

    // If the written file is the project context, detect workflow type and update state.json
    if (safePath.includes("project-context.md")) {
      try {
        const llm = new OllamaAdapter();
        // const llm = new GeminiAdapter();
        const detected = await llm.GetWorkFlowType(projectId, action.content, { signal });
        let workflowFile = "greenfield.yaml";
        console.log(`Detected workflow type: ${detected}`);
        if (detected.includes("greenfield.yaml") && !detected.includes("brownfield.yaml")) {
          logger.info(`[${MODULE}] Detected workflow type ${detected} for project ${projectId}`);
          workflowFile = "greenfield.yaml";
        } else {
          logger.info(`[${MODULE}] Detected workflow type ${detected} for project ${projectId}`);
          workflowFile = "brownfield.yaml";
        }

        if (workflowFile) {
          try {
            const state = ProjectStateRepository.load(projectId)  || null;
            if (state) {
            state.workflowFile = workflowFile;
            ProjectStateRepository.save(projectId, state);
            }
            resultContent = `SUCCESS_WORKFLOW_${workflowFile}`;
            logger.info(`[${MODULE}] Saved detected workflow ${workflowFile} to state.json for project ${projectId}`);
          } catch (err: any) {
            logger.error(`[${MODULE}] Failed to save workflow to state.json: ${err?.message || err}`);
            resultContent = "SUCCESS_WORKFLOW_SAVE_ERROR";
          }
        } else {
          logger.warn(`[${MODULE}] Workflow type not detected for project ${projectId}`);
          resultContent = "SUCCESS_WORKFLOW_NOT_DETECTED";
        }
      } catch (err: any) {
        logger.error(`[${MODULE}] Failed to detect workflow type: ${err?.message || err}`);
        resultContent = "SUCCESS_WORKFLOW_ERROR";
      }
    }

    context.sysResults.push({
      type: "WRITE",
      target: action.target,
      content: resultContent,
    });
  }
}