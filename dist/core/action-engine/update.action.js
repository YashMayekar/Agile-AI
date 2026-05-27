"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateHandler = void 0;
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../../utils/logger");
const MODULE = "update.action.ts";
class UpdateHandler {
    execute(projectId, safePath, action, context) {
        logger_1.logger.info(`[${MODULE}] UPDATE intercepted → forcing READ first`);
        let content;
        try {
            if (!fs_1.default.existsSync(safePath)) {
                content = "FILE_NOT_FOUND";
            }
            else {
                content = fs_1.default.readFileSync(safePath, "utf-8");
            }
        }
        catch (e) {
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
exports.UpdateHandler = UpdateHandler;
