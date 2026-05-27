"use strict";
/**
 * Safe file system utility layer.
 * Abstracts Node fs operations.
 * Adds validation and logging.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSystem = void 0;
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("./logger");
class FileSystem {
    static ensureDir(dirPath) {
        if (!fs_1.default.existsSync(dirPath)) {
            fs_1.default.mkdirSync(dirPath, { recursive: true });
            logger_1.logger.debug("DIR_CREATED", { dirPath });
        }
    }
    static deleteDir(dirPath) {
        if (fs_1.default.existsSync(dirPath)) {
            fs_1.default.rmSync(dirPath, { recursive: true, force: true });
            logger_1.logger.debug("DIR_DELETED", { dirPath });
        }
    }
    static readFile(filePath) {
        return fs_1.default.readFileSync(filePath, 'utf-8');
    }
    static readJSON(filePath) {
        const content = fs_1.default.readFileSync(filePath, "utf-8");
        return JSON.parse(content);
    }
    static writeJSON(filePath, data) {
        fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2));
        logger_1.logger.debug("FILE_WRITTEN", { filePath });
    }
    static writeFile(filePath, content) {
        fs_1.default.writeFileSync(filePath, content);
        logger_1.logger.debug("FILE_CREATED_OR_UPDATED", { filePath });
    }
    static exists(filePath) {
        return fs_1.default.existsSync(filePath);
    }
}
exports.FileSystem = FileSystem;
