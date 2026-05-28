/**
 * Handles reading and writing project state from disk.
 * All state persistence must go through this repository.
 */

import path from "path";
import { FileSystem } from "../../utils/file-system";
import { ProjectState } from "./project-state.model";
import { logger } from "../../utils/logger";
import { ProjectProcessInfo } from "./project-state.model";

export const projectProcessInfo = new Map<string, ProjectProcessInfo>();

export class ProjectStateRepository {

  static getProjectPath(projectId: string) {
    return path.join("projects", projectId);
  }

  static getStatePath(projectId: string) {
    return path.join(this.getProjectPath(projectId), "state.json");
  }

  private static getHistoryPath(projectId: string): string {
      return path.join("projects", projectId, "history.json");
  } 

  static load(projectId: string): ProjectState | null {
    if (!FileSystem.exists(this.getStatePath(projectId))) {
      logger.warn(`No existing state found for project ${projectId}. Initializing new state.`); 
      return null;
    } else { 
      return FileSystem.readJSON(this.getStatePath(projectId)); 
    } 
  }

  static save(projectId: string, state: ProjectState) {
    FileSystem.writeJSON(this.getStatePath(projectId), state);
  }
  
}
