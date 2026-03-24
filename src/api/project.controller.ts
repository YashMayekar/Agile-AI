import express from "express";
import { v4 as uuidv4 } from "uuid";
import { FileSystem } from "../utils/file-system";
import { ChatHistoryEntry, ProjectState } from "../core/project-state/project-state.model";
import path from "path";
import { logger } from "../utils/logger";
import { Orchestrator } from "../core/orchestrator";
import { OllamaAdapter } from "../llm/ollama.adapter";

const MODULE = "project.controller.ts";
const router = express.Router();

// Cache to hold LLM instances per project
const llmInstances = new Map<string, OllamaAdapter>();

/**
 * POST /api/project/init
 * Creates a new project and returns the project ID.
 */
router.post("/init", async (req, res) => {
  const { tree } = req.body;
  logger.info(`[${MODULE}] PROJECT_INITIALIZATION_STARTED - Initializing new project`);

  const projectId = uuidv4();
  const projectPath = path.join("projects", projectId);

  FileSystem.ensureDir(projectPath);
  FileSystem.ensureDir(path.join(projectPath, "docs"));

  // Initial state (kept for compatibility)
  const initialState: ProjectState = {
    projectId,
    mode: null,
    phase: "planning",
    currentStepId: 0,
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

  logger.warn(`[${MODULE}] Received streaming message for project ${projectId}: ${userInput}`);

  // Retrieve the cached LLM instance for this project
  const llm = llmInstances.get(projectId);
  if (!llm) {
    const llm = new OllamaAdapter();
    llmInstances.set(projectId, llm); 
    // res.status(404).json({ error: "Project not initialized or LLM instance missing" });
    // return;
    
  }

  try {
    const stream = Orchestrator.handleUserInput(projectId, userInput, llm);
    for await (const chunk of stream) {
      res.write(JSON.stringify(chunk) + "\n");
    }
    res.end();
  } catch (error: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(JSON.stringify({ error: error.message }) + "\n");
      res.end();
    }
  }
});

export default router;