"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwitchHandler = void 0;
const logger_1 = require("../../utils/logger");
const project_state_repository_1 = require("../project-state/project-state.repository");
const MODULE = "switch.action.ts";
class SwitchHandler {
    execute(projectId, safePath, action, context) {
        let state;
        try {
            state = project_state_repository_1.ProjectStateRepository.load(projectId) || {};
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to load project state: ${e?.message || e}`);
            context.sysResults.push({ type: "WORKFLOW", target: action.target, content: "WORFLOW_LOAD_ERROR" });
            return;
        }
        logger_1.logger.info(`[${MODULE}] SWITCH-AG action ignored`);
    }
}
exports.SwitchHandler = SwitchHandler;
