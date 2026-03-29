import express from "express";
import { v4 as uuidv4 } from "uuid";
import { FileSystem } from "../utils/file-system";
import { ChatHistoryEntry, ProjectState } from "../core/project-state/project-state.model";
import path from "path";
import { logger } from "../utils/logger";
import { Orchestrator } from "../core/orchestrator";
import { OllamaAdapter } from "../llm/ollama.adapter";
import { BaseActionEngine } from "../core/action-engine/base-engine";
import fs from "fs";


const MODULE = "project.controller.ts";
const router = express.Router();

// Cache to hold LLM instances per project
interface SystemStatus {
  object: string;
  message: string;
}

export const llmInstances = new Map<string, OllamaAdapter>();
export const systemStatuses = new Map<string, SystemStatus>();


router.get("/:projectId/status", (req, res) => {
  const { projectId } = req.params;

  const status = systemStatuses.get(projectId) || "IDLE";
  res.json({ status })
});

router.get("/:projectId/history", (req, res) => {
  try {
    logger.info(`[${MODULE}] HISTORY_REQUESTED - Requesting history for project ${req.params.projectId}`);
    const historyPath = path.join("projects", req.params.projectId, "history.json");
    if (FileSystem.exists(historyPath)) {
      const history = FileSystem.readJSON(historyPath);
      res.json(history);
      logger.info(`[${MODULE}] HISTORY_SENT - History sent for project ${req.params.projectId}`);
      // console.log(`CHAT HISTORY:\n${JSON.stringify(history)}`)
    } else {
      res.json([]);
      logger.info(`[${MODULE}] HISTORY_NOT_FOUND - History not found for project ${req.params.projectId}`);
    }
  } catch (err) {
    logger.error(`[${MODULE}] Failed to read history: ${err}`);
    res.status(500).json({ error: "Failed to read history" });
  }
});

/**
 * DELETE /api/project/:projectId
 * Deletes a project by ID including its directory and state in memory.
 */
router.delete("/:projectId", (req, res) => {
  try {
    const { projectId } = req.params;
    logger.info(`[${MODULE}] DELETE_REQUESTED - Requesting deletion for project ${projectId}`);
    const projectPath = path.join("projects", projectId);

    if (FileSystem.exists(projectPath)) {
      FileSystem.deleteDir(projectPath);
      llmInstances.delete(projectId);
      systemStatuses.delete(projectId);
      res.json({ message: `Project ${projectId} deleted successfully` });
      logger.info(`[${MODULE}] PROJECT_DELETED - Project ${projectId} deleted successfully`);
    } else {
      res.status(404).json({ error: "Project not found" });
      logger.warn(`[${MODULE}] PROJECT_NOT_FOUND - Project ${projectId} not found for deletion`);
    }
  } catch (err) {
    logger.error(`[${MODULE}] Failed to delete project: ${err}`);
    res.status(500).json({ error: "Failed to delete project" });
  }
});

/**
 * POST /api/project/init
 * Creates a new project and returns the project ID.
*/
router.post("/init", async (req, res) => {
  const { tree } = req.body;

  const projectId = uuidv4();
  const projectPath = path.join("projects", projectId);

  logger.info(`[${MODULE}] PROJECT_INITIALIZATION_STARTED - Initializing new project`);

  FileSystem.ensureDir(projectPath);
  FileSystem.ensureDir(path.join(projectPath, "docs"));

  // Initial state (kept for compatibility)
  const initialState: ProjectState = {
    projectId,
    mode: null,
    phase: "planning",
    currentStepId: 0,
    currentAgent: "orchestrator",
    systemStatus: "INITIALIZING PROJECT",
    workflowFile: "",
    documents: {},
    completedSteps: [],
    contextMemory: {
      summary: "",
      decisions: [],
      architectureNotes: []
    },
    dynamicContext: {
      stories: [],
      currentStoryIndex: 0,
      qaLeftUnchecked: false,
      fileTree: tree
    }
  };
  const initialHistory: ChatHistoryEntry[] = [];

  FileSystem.writeJSON(path.join(projectPath, "state.json"), initialState);
  FileSystem.writeJSON(path.join(projectPath, "history.json"), initialHistory);

  // Create and store the LLM instance for this project
  const llm = new OllamaAdapter();
  llmInstances.set(projectId, llm);

  logger.info(`[${MODULE}] PROJECT_INITIALIZATED - ID: ${projectId}`);

  res.json({ projectId });
});

/**
 * POST /api/project/:projectId/m/s
 * Non‑streaming message handling (streaming via generator).
 */
router.post("/:projectId/m/s", async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  const { projectId } = req.params;
  const { userInput } = req.body;


  logger.debug(`[${MODULE}] Input received from user: ${userInput}`);

  // Retrieve the cached LLM instance for this project
  const llm = llmInstances.get(projectId);
  if (!llm) {
    const llm = new OllamaAdapter();
    llmInstances.set(projectId, llm);
  }


  try {
    const stream = Orchestrator.handleUserInput(projectId, userInput, llm);
    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk) + "\n");
    }
    // res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ error: error.message }) + "\n");
    }
  }

  if (BaseActionEngine.ReadResults.length) {
    const llm = llmInstances.get(projectId);
    if (!llm) {
      const llm = new OllamaAdapter();
      llmInstances.set(projectId, llm);
    }

    const input = `
    These are the result of the READ request respones provided by the SYSTEM from the previous response,
    ${BaseActionEngine.getAggregatedReadContext()}

    And there might be some responses, that were skipped due to this READ actions:
    ${BaseActionEngine.getSkippedSteps()}

    *See the CONVERSATION HISTORY* to know about what you were doing after reading,
    and also consider any skipped ACTIONS.
    RESPOND ACCORDINGLY
    `
    try {
      const stream = Orchestrator.handleUserInput(projectId, input, llm);
      for await (const chunk of stream) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      // res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.write(JSON.stringify({ error: error.message }) + "\n");
      }
    }
  }

  BaseActionEngine.ReadResults = [];

  if (BaseActionEngine.sysResults.length && BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type === "WORKFLOW") {
    const llm = llmInstances.get(projectId);
    if (!llm) {
      const llm = new OllamaAdapter();
      llmInstances.set(projectId, llm);
    }

    // Check is the project-context file exist, if yes then load the project-context in the input prompt.

    const projectContextPath = path.join(__dirname, projectId, "projects", projectId, "docs", "project-context.md");
    // logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
    let projectContext = "";
    if (FileSystem.exists(projectContextPath)) {
      projectContext = `This is the project context:\n${fs.readFileSync(projectContextPath, "utf-8")}`;
    }
    // logger.warn(`[${MODULE}] Project context file not found at ${projectContextPath}`);
            
    const inputPrompt = `${projectContext}\n\nGreet the user and introduce yourself in short and explain what you will do now`
    
    try {
      const stream = Orchestrator.handleUserInput(projectId, inputPrompt, llm);
      for await (const chunk of stream) {
        res.write(JSON.stringify(chunk) + "\n");
      }
      // res.end();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      } else {
        res.write(JSON.stringify({ error: error.message }) + "\n");
      }
    }
  }
  BaseActionEngine.sysResults.push({
      type: "NONE",
      target: "",
      content: ""
    });
  res.end();
  

});

export default router;