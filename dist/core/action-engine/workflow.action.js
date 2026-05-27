"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowHandler = void 0;
const logger_1 = require("../../utils/logger");
const project_state_repository_1 = require("../project-state/project-state.repository");
const workflow_engine_1 = require("../workflow-engine");
const MODULE = "workflow.action.ts";
class WorkflowHandler {
    execute(projectId, safePath, action, context) {
        logger_1.logger.info(`[${MODULE}] Executing workflow action ${action.target} for ${projectId}`);
        let state;
        try {
            state = project_state_repository_1.ProjectStateRepository.load(projectId) || {};
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to load project state: ${e?.message || e}`);
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
        }
        else {
            const parsedTarget = Number(action.target);
            if (!Number.isNaN(parsedTarget)) {
                newStep = parsedTarget;
            }
            else {
                logger_1.logger.warn(`[${MODULE}] Invalid workflow target: ${action.target}`);
                context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "INVALID_TARGET" });
                return;
            }
        }
        state.currentStepId = String(newStep);
        state.currentAgent = workflow_engine_1.WorkflowEngine.getStepById(newStep).agent;
        state.systemStatus = workflow_engine_1.WorkflowEngine.getStepById(newStep) ? `Moved to step ${newStep}: ${workflow_engine_1.WorkflowEngine.getStepById(newStep).name}` : "Executing step";
        state.currentStepName = workflow_engine_1.WorkflowEngine.getStepById(newStep).name;
        try {
            project_state_repository_1.ProjectStateRepository.save(projectId, state);
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to save project state: ${e?.message || e}`);
            context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "SAVE_ERROR" });
            return;
        }
        context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "SUCCESS" });
    }
}
exports.WorkflowHandler = WorkflowHandler;
