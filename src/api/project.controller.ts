import express from "express";
import { v4 as uuidv4 } from "uuid";
import { FileSystem } from "../utils/file-system";
import { ChatHistoryEntry, ProjectState } from "../core/project-state/project-state.model";
import path from "path";
import { logger} from "../utils/logger";
import { Orchestrator } from "../core/orchestrator";
import { OllamaAdapter } from "../llm/ollama.adapter";

const MODULE = "project.controller.ts";
const router = express.Router();

// Cache to hold LLM instances per project
export const llmInstances = new Map<string, OllamaAdapter>();
export let systemStatus = ""


router.get("/:projectId/status",(req, res) => {
  const { projectId } = req.params;
  
  res.json({ status: systemStatus})
})

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