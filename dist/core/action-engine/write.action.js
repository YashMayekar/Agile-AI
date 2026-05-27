"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WriteHandler = void 0;
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../../utils/logger");
const project_state_repository_1 = require("../project-state/project-state.repository");
const ollama_adapter_1 = require("../../llm/ollama.adapter");
const project_controller_1 = require("../../api/project.controller");
const MODULE = "write.action.ts";
class WriteHandler {
    async execute(projectId, safePath, action, context) {
        logger_1.logger.info(`[${MODULE}] Writing ${safePath}`);
        let state;
        try {
            // Ensure the directory exists
            const dir = require("path").dirname(safePath);
            if (!fs_1.default.existsSync(dir)) {
                fs_1.default.mkdirSync(dir, { recursive: true });
                logger_1.logger.info(`[${MODULE}] Created directory ${dir}`);
            }
            fs_1.default.writeFileSync(safePath, action.content);
            project_controller_1.systemStatuses.set(projectId, { object: "", message: "WRITE_SUCCESS: " + safePath });
            state = project_state_repository_1.ProjectStateRepository.load(projectId) || {};
            // get filename
            const filename = safePath.split('\\').pop() || "";
            const new_version = state.documents[filename] ? state.documents[filename].version + 1 : 1;
            state.documents[filename] = { status: "completed", version: new_version, updatedAt: new Date().toISOString() };
            project_state_repository_1.ProjectStateRepository.save(projectId, state);
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to write file ${safePath}: ${e?.message || e}`);
            context.sysResults.push({ type: "WRITE", target: action.target, content: "WRITE_ERROR" });
            project_controller_1.systemStatuses.set(projectId, { object: "", message: "WRITE_ERROR: " + e?.message || e });
            return;
        }
        let resultContent = "SUCCESS";
        // If the written file is the project context, detect workflow type and update state.json
        if (safePath.includes("project-context.md")) {
            try {
                const llm = new ollama_adapter_1.OllamaAdapter();
                // const llm = new GeminiAdapter();
                const detected = await llm.GetWorkFlowType(projectId, action.content);
                let workflowFile = "greenfield.yaml";
                console.log(`Detected workflow type: ${detected}`);
                if (detected.includes("greenfield.yaml") && !detected.includes("brownfield.yaml")) {
                    logger_1.logger.info(`[${MODULE}] Detected workflow type ${detected} for project ${projectId}`);
                    workflowFile = "greenfield.yaml";
                }
                else {
                    logger_1.logger.info(`[${MODULE}] Detected workflow type ${detected} for project ${projectId}`);
                    workflowFile = "brownfield.yaml";
                }
                if (workflowFile) {
                    try {
                        const state = project_state_repository_1.ProjectStateRepository.load(projectId) || null;
                        if (state) {
                            state.workflowFile = workflowFile;
                            project_state_repository_1.ProjectStateRepository.save(projectId, state);
                        }
                        resultContent = `SUCCESS_WORKFLOW_${workflowFile}`;
                        logger_1.logger.info(`[${MODULE}] Saved detected workflow ${workflowFile} to state.json for project ${projectId}`);
                    }
                    catch (err) {
                        logger_1.logger.error(`[${MODULE}] Failed to save workflow to state.json: ${err?.message || err}`);
                        resultContent = "SUCCESS_WORKFLOW_SAVE_ERROR";
                    }
                }
                else {
                    logger_1.logger.warn(`[${MODULE}] Workflow type not detected for project ${projectId}`);
                    resultContent = "SUCCESS_WORKFLOW_NOT_DETECTED";
                }
            }
            catch (err) {
                logger_1.logger.error(`[${MODULE}] Failed to detect workflow type: ${err?.message || err}`);
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
exports.WriteHandler = WriteHandler;
