"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadHandler = void 0;
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../../utils/logger");
const MODULE = "read.action.ts";
class ReadHandler {
    execute(projectId, safePath, action, context) {
        logger_1.logger.info(`[${MODULE}] Reading ${safePath}`);
        let content;
        try {
            if (!fs_1.default.existsSync(safePath)) {
                content = "FILE_NOT_FOUND";
                logger_1.logger.warn(`[${MODULE}] FILE_NOT_FOUND for ${safePath}`);
            }
            else {
                content = fs_1.default.readFileSync(safePath, "utf-8");
            }
        }
        catch (e) {
            content = "READ_ERROR";
            logger_1.logger.error(`[${MODULE}] READ_ERROR for ${safePath}`);
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
exports.ReadHandler = ReadHandler;
