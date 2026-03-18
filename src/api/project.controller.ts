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

const MODULE = "project.controller.ts";

const router = express.Router();

/**
 * POST /api/project/:projectId/message
 * Non‑streaming message handling.
 */
router.post("/:projectId/message", async (req, res) => {
  const { projectId } = req.params;
  const { userInput } = req.body;

  try {
    const result = await Orchestrator.handleUserInput(projectId, userInput);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/project/init
 * Creates a new project and returns the initial greeting.
 */
router.post("/init", async (req, res) => {
  const { tree, mode = "greenfield" } = req.body;
  logger.info(`[${MODULE}] PROJECT_INITIALIZATION_STARTED: Initializing new project in ${mode} mode...`);

  const projectId = uuidv4();
  const projectPath = path.join("projects", projectId);

  FileSystem.ensureDir(projectPath);
  FileSystem.ensureDir(path.join(projectPath, "docs"));

  // Initial state compatible with dynamic workflow
  const initialState: ProjectState = {
    projectId,
    mode: mode as "greenfield" | "brownfield",
    phase: "planning",
    currentStepId: 0,
    workflowFile: mode === "brownfield" ? "brownfield.yaml" : "greenfield.yaml",
    documents: {},
    completedSteps: [],
    history: [],
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

  FileSystem.writeJSON(path.join(projectPath, "state.json"), initialState);

  try {


    // Get initial greeting from orchestrator
    // const result = await Orchestrator.handleUserInput(projectId, "Greet Me in short");
    // res.json( projectId );

    const greetingResult = await Orchestrator.handleUserInput(projectId, "Greet me briefly");
  const greeting = greetingResult.message + greetingResult.content;  // adjust according to actual return type

  res.json({ projectId, greeting });
    // If brownfield, analyze asynchronously
    if (mode === "brownfield") {
      (async () => {
        const analysis = await BrownfieldAnalyzer.analyze(projectPath);
        const analysisPath = path.join(projectPath, "docs/project-analysis.md");
        FileSystem.writeFile(analysisPath, analysis);
        logEvent("BROWNFIELD_ANALYSIS_COMPLETE", { projectId });
      })().catch(err => logger.error(`[${MODULE}] Brownfield analysis failed: ${err.message}`));
    }

  } catch (error: any) {
    logger.error(`[${MODULE}] Failed to generate greeting: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;