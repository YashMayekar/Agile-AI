import express from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { projectProcessInfo } from "../core/project-state/project-state.repository";
import { ProjectProcessInfo } from "../core/project-state/project-state.model";

import { FileSystem } from "../utils/file-system";
import {
  ChatHistoryEntry,
  ProjectState
} from "../core/project-state/project-state.model";

import {
  logger,
  withProjectLogging
} from "../utils/logger";

import { Orchestrator } from "../core/orchestrator";
import { OllamaAdapter } from "../llm/ollama.adapter";

import { BaseActionEngine } from "../core/action-engine/base-engine";

import { ProjectStateRepository } from "../core/project-state/project-state.repository";
import { ExecutionLock } from "../core/execution-lock";


const MODULE = "project.controller.ts";


/* =========================================================
STREAM PARSER
========================================================= */

class StreamParser {
  private buffer = "";
  private state:
  | "SEEKING_RES"
  | "WAITING_COLON"
  | "INSIDE_RES"
  | "DONE" = "SEEKING_RES";
  private escapeNext = false;
  
  parse(chunk: string): string {
    let output = "";
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (this.state === "SEEKING_RES") {
        this.buffer += char;
        if (this.buffer.endsWith('"res"')) {
          this.state = "WAITING_COLON";
        }
      } else if (this.state === "WAITING_COLON") {
        if (char === '"') {
          this.state = "INSIDE_RES";
        }
      } else if (this.state === "INSIDE_RES") {
        if (this.escapeNext) {
          if (char === "n") output += "\n";
          else if (char === "r") output += "\r";
          else if (char === "t") output += "\t";
          else if (char === "b") output += "\b";
          else if (char === "f") output += "\f";
          else output += char;
          this.escapeNext = false;
        } else if (char === "\\") {
          this.escapeNext = true;
        } else if (char === '"') {
          this.state = "DONE";
        } else {
          output += char;
        }
      }
    }
    return output;
  }
}

/* =========================================================
GLOBAL CACHES
========================================================= */

interface SystemStatus {
  object: string;
  message: string;
}


export const llmInstances = new Map<string, OllamaAdapter>();
export const systemStatuses = new Map<string, SystemStatus>();

const router = express.Router();
// System Health
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: Date.now()
  });
});

/* =========================================================
   STATUS ROUTE
========================================================= */
router.get("/:projectId/status", async (req, res) => {
  const { projectId } = req.params;
  await withProjectLogging(projectId, async () => {
    const currentStep =
      ProjectStateRepository.load(projectId)?.currentStepName ||
      "unknown";
    const status =
      systemStatuses.get(projectId) || {
        object: "SYSTEM",
        message: "IDLE"
      };
    const currentAgent =
      ProjectStateRepository.load(projectId)?.currentAgent ||
      "unknown";
    res.json({
      status,
      currentStep,
      currentAgent
    });
  });
});

/* =========================================================
   HISTORY ROUTE
========================================================= */
router.get("/:projectId/history", async (req, res) => {
  const { projectId } = req.params;
  await withProjectLogging(projectId, async () => {
    try {
      logger.info(`[${MODULE}] HISTORY_REQUESTED`);
      const historyPath = path.join("projects", projectId, "history.json");
      if (FileSystem.exists(historyPath)) {
        const history = FileSystem.readJSON(historyPath);
        res.json(history);
        logger.info(`[${MODULE}] HISTORY_SENT`);
      } else {
        res.json([]);
        logger.warn(`[${MODULE}] HISTORY_NOT_FOUND`);
      }
    } catch (err: any) {
      logger.error(`[${MODULE}] HISTORY_READ_FAILED`, {
        error: err?.message,
        stack: err?.stack
      });
      res.status(500).json({
        error: "Failed to read history"
      });
    }
  });
});

/* =========================================================
   ABORT ROUTE (without deleting)
========================================================= */
router.post("/:projectId/abort", async (req, res) => {
  const { projectId } = req.params;
  await withProjectLogging(projectId, async () => {
    try {
      logger.warn(`[${MODULE}] ABORT_REQUESTED for project ${projectId}`);
      const processInfo = projectProcessInfo.get(projectId);
      if (processInfo) {
        processInfo.project_AbortController.abort();
        processInfo.active = false    ;
        logger.info(`[${MODULE}] ABORT_SIGNAL_SENT`);
        ExecutionLock.release(projectId);
        res.json({ message: `Processes for project ${projectId} aborted` });
      } else {
        logger.warn(`[${MODULE}] NO_ACTIVE_PROCESS_TO_ABORT`);
        res.status(404).json({ error: "No active process found for this project" });
      }
    } catch (err: any) {
      logger.error(`[${MODULE}] ABORT_FAILED`, {
        error: err?.message,
        stack: err?.stack
      });
      res.status(500).json({ error: "Failed to abort processes" });
    }
  });
});

/* =========================================================
   DELETE PROJECT (with abort)
========================================================= */
router.delete("/:projectId", async (req, res) => {
  const { projectId } = req.params;
  await withProjectLogging(projectId, async () => {
    try {
      logger.info(`[${MODULE}] DELETE_REQUESTED`);

      // Abort any running streams for this project
      const processInfo = projectProcessInfo.get(projectId);
      if (processInfo) {
        processInfo.project_AbortController.abort();
        processInfo.active = false;
        await new Promise(resolve => setTimeout(resolve, 500)); // grace period
        projectProcessInfo.delete(projectId);
      }


      const projectPath = path.join("projects", projectId);
      if (FileSystem.exists(projectPath)) {
        FileSystem.deleteDir(projectPath);
        llmInstances.delete(projectId);
        systemStatuses.delete(projectId);
        logger.info(`[${MODULE}] PROJECT_DELETED`);
        res.json({ message: `Project ${projectId} deleted successfully` });
      } else {
        logger.warn(`[${MODULE}] PROJECT_NOT_FOUND`);
        res.status(404).json({ error: "Project not found" });
      }
    } catch (err: any) {
      logger.error(`[${MODULE}] DELETE_FAILED`, {
        error: err?.message,
        stack: err?.stack
      });
      res.status(500).json({ error: "Failed to delete project" });
    }
  });
});

/* =========================================================
   INIT PROJECT
========================================================= */
router.post("/init", async (req, res) => {
  const { tree, planning } = req.body;
  const projectId = uuidv4();
  await withProjectLogging(projectId, async () => {
    try {
      logger.info(`[${MODULE}] PROJECT_INITIALIZATION_STARTED`);
      const projectPath = path.join("projects", projectId);
      FileSystem.ensureDir(projectPath);
      FileSystem.ensureDir(path.join(projectPath, "docs"));

      const initialState: ProjectState = {
        projectId,
        mode: null,
        phase: planning !== false ? "planning" : "development",
        currentStepId: 1,
        currentAgent: "analyst",
        currentStepName: "Perform Brainstorming or Creating Project Brief",
        systemStatus: "INITIALIZING PROJECT",
        workflowFile: "",
        documents: {},
        completedSteps: [],
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

      const llm = new OllamaAdapter();
      llmInstances.set(projectId, llm);

      projectProcessInfo.set(projectId, {
        projectId,
        project_AbortController: new AbortController(),
        active: true,
        subProcesses: new Map()
      });
      
      logger.info(`[${MODULE}] PROJECT_INITIALIZED`);
      res.json({ projectId });
    } catch (err: any) {
      logger.error(`[${MODULE}] PROJECT_INITIALIZATION_FAILED`, {
        error: err?.message,
        stack: err?.stack
      });
      res.status(500).json({ error: "Failed to initialize project" });
    }
  });
});

/* =========================================================
   MAIN MESSAGE STREAM ROUTE (with abort signal)
========================================================= */
router.post("/:projectId/m/s", async (req, res) => {
  const { projectId } = req.params;
  const ChatId = uuidv4();
  await withProjectLogging(projectId, async () => {
    res.setHeader("Content-Type", "application/json");
    const { userInput, planning } = req.body;
    logger.info(`[${MODULE}] MESSAGE_STREAM_STARTED`);

    let llm = llmInstances.get(projectId);
    if (!llm) {
      logger.warn(`[${MODULE}] LLM_INSTANCE_NOT_FOUND`);
      llm = new OllamaAdapter();
      llmInstances.set(projectId, llm);
      logger.info(`[${MODULE}] NEW_LLM_INSTANCE_CREATED`);
    }

    const writeChunk = (data: any) => {
      res.write(JSON.stringify(data) + "\n");
    };

    const processInfo = projectProcessInfo.get(projectId);
    if (!processInfo) {
      logger.warn(`[${MODULE}] NO_PROCESS_INFO_FOUND, CREATING_NEW_ONE`);
      const newProcessInfo: ProjectProcessInfo = {
        projectId,
        project_AbortController: new AbortController(),
        active: true,
        subProcesses: new Map()
      };
      projectProcessInfo.set(projectId, newProcessInfo);
    } else if (!processInfo.active) {
      logger.warn(`[${MODULE}] INACTIVE_PROCESS_INFO_FOUND, REACTIVATING`);
      processInfo.project_AbortController = new AbortController();
      processInfo.active = true;
    }    

    try {
      /* =====================================================
         PRIMARY STREAM
      ===================================================== */
      logger.info(`[${MODULE}] PRIMARY_STREAM_STARTED`);
      const stream1 = Orchestrator.handleUserInput(
        projectId,
        userInput,
        llm,
        planning
      );

      const parser1 = new StreamParser();
      for await (const chunk of stream1) {
        if (chunk.res || chunk.think) {
          const out: any = {};
          if (chunk.res) {
            if (!planning) {
              out.res = parser1.parse(chunk.res);
            } else {
              out.res = chunk.res;
            }
          }
          if (chunk.think) out.think = chunk.think;
          writeChunk(out);
        } else if (!chunk.done) {
          writeChunk(chunk);
        }
      }
      writeChunk({ done: true });
      logger.info(`[${MODULE}] PRIMARY_STREAM_COMPLETED`);

      // if (signal.aborted) throw new Error("Aborted by user or system");

      /* =====================================================
         WORKFLOW GREETING (if needed)
      ===================================================== */
      if (
        BaseActionEngine.sysResults.length &&
        BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type === "WORKFLOW"
      ) {
        logger.info(`[${MODULE}] WORKFLOW_ACTION_DETECTED`);
        writeChunk({ status: "Preparing project context..." });
        const workflowPrompt = `
WORKFLOW CHANGE DETECTED:
Now you act as if you are greeting the user for the new workflow step.
Tell the user what you can do for them in this step in short and concise manner.
If you have any questions for the user to clarify before starting the step, ask them now.
        `;
        const stream2 = Orchestrator.handleSystemInput(
          projectId,
          workflowPrompt,
          llm,
          // signal
        );
        for await (const chunk of stream2) {
          if (chunk.res || chunk.think) {
            const out: any = {};
            if (chunk.res) out.res = chunk.res;
            if (chunk.think) out.think = chunk.think;
            writeChunk(out);
          } else if (!chunk.done) {
            writeChunk(chunk);
          }
        }
        writeChunk({ done: true });
        logger.info(`[${MODULE}] WORKFLOW_GREETING_COMPLETED`);
        BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type = "NONE";
      }

      BaseActionEngine.sysResults.push({ type: "NONE", target: "", content: "" });

      // const currentProcess = projectProcessInfo.get(projectId);
      // if (currentProcess) {
      //   currentProcess.active = false;
      // }

      logger.info(`[${MODULE}] MESSAGE_STREAM_COMPLETED`);
    } catch (error: any) {
      if (error.message === "Aborted by user or system") {
        logger.warn(`[${MODULE}] STREAM_ABORTED for project ${projectId}`);
        writeChunk({ done: true, aborted: true, message: "Operation cancelled." });
      } else {
        logger.error(`[${MODULE}] MESSAGE_STREAM_FAILED`, {
          error: error?.message,
          stack: error?.stack
        });
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        } else {
          writeChunk({ error: error.message });
        }
      }
    } finally {
      res.end();
      // cleanup();
      logger.info(`[${MODULE}] RESPONSE_CLOSED`);
    }
  });
});

export default router;