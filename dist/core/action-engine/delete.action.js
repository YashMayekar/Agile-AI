"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeleteHandler = void 0;
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../../utils/logger");
const MODULE = "delete.action.ts";
class DeleteHandler {
    execute(projectId, safePath, action, context) {
        logger_1.logger.info(`[${MODULE}] Deleting ${safePath}`);
        if (fs_1.default.existsSync(safePath)) {
            fs_1.default.unlinkSync(safePath);
        }
        context.sysResults.push({
            type: "DELETE",
            target: action.target,
            content: "SUCCESS",
        });
    }
}
exports.DeleteHandler = DeleteHandler;
