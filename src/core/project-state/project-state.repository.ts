/**
 * Handles reading and writing project state from disk.
 * All state persistence must go through this repository.
 */

import path from "path";
import { FileSystem } from "../../utils/file-system";
import { ProjectState } from "./project-state.model";
import { logger } from "../../utils/logger";

export class ProjectStateRepository {

  static getProjectPath(projectId: string) {
    return path.join("projects", projectId);
  }

  static getStatePath(projectId: string) {
    return path.join(this.getProjectPath(projectId), "state.json");
  }

  static load(projectId: string): ProjectState {
    return FileSystem.readJSON(this.getStatePath(projectId));
  }

  static save(projectId: string, state: ProjectState) {
    FileSystem.writeJSON(this.getStatePath(projectId), state);
  }
  
}
