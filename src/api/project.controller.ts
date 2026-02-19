/**
 * Project Controller
 *
 * API Layer.
 * Receives frontend requests.
 * Delegates to Orchestrator.
 */

import express from "express";
import { Orchestrator } from "../core/orchestrator";
import { v4 as uuidv4 } from "uuid";
import { FileSystem } from "../utils/file-system";
import { ProjectState } from "../core/project-state/project-state.model";
import path from "path";
import { BrownfieldAnalyzer } from "../core/brownfield-analyzer";
import { logEvent, logger } from "../utils/logger";
import { log } from "console";
import { level } from "winston";

const router = express.Router();

/**
 * POST /api/project/:projectId/message
 */
router.post("/:projectId/message", async (req, res) => {

  const { projectId } = req.params;
  const { userInput } = req.body;

  try {

    const result = await Orchestrator.handleUserInput(
      projectId,
      userInput
    );

    res.json(result);

  } catch (error: any) {

    res.status(500).json({
      error: error.message
    });
  }
});
/**
 * POST /api/project/init
 */
router.post("/init", async (req, res) => {

  const { mode } = req.body; // greenfield | brownfield
  // logger.info(level, `${level}: Initializing new project in ${mode} mode...`);
  logger.debug(`Initializing new project in ${mode} mode...`);
  logger.info(`PROJECT_INITIALIZATION_STARTED: Initializing new project in ${mode} mode...`);
  // logEvent("PROJECT_INITIALIZATION_STARTED", { mode });
  const projectId = uuidv4();
  const projectPath = path.join("projects", projectId);

  FileSystem.ensureDir(projectPath);
  FileSystem.ensureDir(path.join(projectPath, "docs"));

  const initialState: ProjectState = {
    projectId,
    mode,
    phase : "planning",
    currentStepId: 1,
    workflowFile: mode === "greenfield" ? "greenfield.yaml" : "brownfield.yaml",
    documents: {},
    completedSteps: [],
    pendingSteps: [1],
    blockedSteps: [],
    history: [],
    contextMemory: {
      summary: "",
      decisions: [],
      architectureNotes: []
    }
  };

  FileSystem.writeJSON(path.join(projectPath, "state.json"), initialState);

  // If brownfield, analyze project
  if (mode === "brownfield") {
    const analysis = await BrownfieldAnalyzer.analyze(projectPath);
    FileSystem.writeFile(path.join(projectPath, "docs/project-analysis.md"), analysis);
  }

  res.json({ projectId });
});


export default router;
