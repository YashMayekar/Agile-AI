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
import { GeminiAdapter } from "../llm/gemini.adapter";


const MODULE = "project.controller.ts";
const router = express.Router();

// Cache to hold LLM instances per project
interface SystemStatus {
  object: string;
  message: string;
}

export const llmInstances = new Map<string, OllamaAdapter | GeminiAdapter>();
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
// src/api/project.controller.ts (relevant parts)

router.post("/:projectId/m/s", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const { projectId } = req.params;
  const { userInput } = req.body;

  // ensure LLM instance exists
  let llm = llmInstances.get(projectId);
  if (!llm) {
    llm = new OllamaAdapter();
    // llm = new GeminiAdapter();
    llmInstances.set(projectId, llm);
  }

  // Helper to write a JSON line
  const writeChunk = (data: any) => res.write(JSON.stringify(data) + "\n");

  try {
    // ---------- 1st response: direct user input ----------
    const stream1 = Orchestrator.handleUserInput(projectId, userInput, llm);
    for await (const chunk of stream1) {
      writeChunk(chunk);
    }
    writeChunk({ done: true });   // end of first message

    // ---------- 2nd response: read results if any ----------
    if (BaseActionEngine.ReadResults.length) {
      writeChunk({ status: "Processing read results..." });
      const readContext = BaseActionEngine.getAggregatedReadContext();
      const skipped = BaseActionEngine.getSkippedSteps();
      const input2 = `
These are the results of READ requests provided by the SYSTEM from the previous response.
${readContext}
Skipped actions: ${skipped}
See conversation history and respond accordingly.`;

      const stream2 = Orchestrator.handleUserInput(projectId, input2, llm);
      for await (const chunk of stream2) {
        writeChunk(chunk);
      }
      writeChunk({ done: true });
      BaseActionEngine.ReadResults = [];   // clear after use
    }


    if (BaseActionEngine.sysResults.length && BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type === "WRITE") {
      const input3 = `This is the file you just created. 
      ${BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].target}
      Now explain user the next steps.`;
      
      const stream3 = Orchestrator.handleUserInput(projectId, input3, llm);
      for await (const chunk of stream3) {
        writeChunk(chunk);
      }
      writeChunk({ done: true });  
    }

    // ---------- 3rd response: workflow greeting if needed ----------
    if (BaseActionEngine.sysResults.length && BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type === "WORKFLOW") {
      writeChunk({ status: "Preparing project context..." });
      const projectContextPath = path.join("projects", projectId, "docs", "project-context.md");
      let projectContext = "";
      if (FileSystem.exists(projectContextPath)) {
        projectContext = `Project context:\n${fs.readFileSync(projectContextPath, "utf-8")}`;
      }
      const input3 = `${projectContext}\n\nGreet the user and introduce yourself in short, explaining what you will do now.`;

      const stream3 = Orchestrator.handleUserInput(projectId, input3, llm);
      for await (const chunk of stream3) {
        writeChunk(chunk);
      }
      writeChunk({ done: true });
    }
    BaseActionEngine.sysResults.push({ type: "NONE", target: "", content: "" });
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      writeChunk({ error: error.message });
    }
  }
  res.end();
});

export default router;