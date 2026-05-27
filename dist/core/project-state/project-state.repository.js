"use strict";
/**
 * Handles reading and writing project state from disk.
 * All state persistence must go through this repository.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectStateRepository = void 0;
const path_1 = __importDefault(require("path"));
const file_system_1 = require("../../utils/file-system");
const logger_1 = require("../../utils/logger");
class ProjectStateRepository {
    static getProjectPath(projectId) {
        return path_1.default.join("projects", projectId);
    }
    static getStatePath(projectId) {
        return path_1.default.join(this.getProjectPath(projectId), "state.json");
    }
    static getHistoryPath(projectId) {
        return path_1.default.join("projects", projectId, "history.json");
    }
    static load(projectId) {
        if (!file_system_1.FileSystem.exists(this.getStatePath(projectId))) {
            logger_1.logger.warn(`No existing state found for project ${projectId}. Initializing new state.`);
            return null;
        }
        else {
            return file_system_1.FileSystem.readJSON(this.getStatePath(projectId));
        }
    }
    static save(projectId, state) {
        file_system_1.FileSystem.writeJSON(this.getStatePath(projectId), state);
    }
}
exports.ProjectStateRepository = ProjectStateRepository;
