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

class StreamParser {
  private buffer = "";
  private state: 'SEEKING_RES' | 'WAITING_COLON' | 'INSIDE_RES' | 'DONE' = 'SEEKING_RES';
  private escapeNext = false;

  parse(chunk: string): string {
    let output = "";
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];
      if (this.state === 'SEEKING_RES') {
        this.buffer += char;
        if (this.buffer.endsWith('"res"')) {
          this.state = 'WAITING_COLON';
        }
      } else if (this.state === 'WAITING_COLON') {
        if (char === '"') {
          this.state = 'INSIDE_RES';
        }
      } else if (this.state === 'INSIDE_RES') {
        if (this.escapeNext) {
          if (char === 'n') output += '\n';
          else if (char === 'r') output += '\r';
          else if (char === 't') output += '\t';
          else if (char === 'b') output += '\b';
          else if (char === 'f') output += '\f';
          else output += char; // handles \", \\, \/
          this.escapeNext = false;
        } else if (char === '\\') {
          this.escapeNext = true;
        } else if (char === '"') {
          this.state = 'DONE';
        } else {
          output += char;
        }
      }
    }
    return output;
  }
}


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
    // let fullRawResponse1 = "";
    // const parser1 = new StreamParser();
    for await (const chunk of stream1) {
      if (chunk.res) {
        // fullRawRespon se1 += chunk.res;
        // const parsedPart = parser1.parse(chunk.res);
        // if (parsedPart) {
        //   writeChunk({ res: parsedPart });
        // }
        writeChunk({ res: chunk.res });
      } else if (chunk.done) {
        // Handle done flag specifically if needed, otherwise rely on the loop end
      } else {
        writeChunk(chunk); // in case there's status or tools we want to forward
      }
    }
    // logger.warn(`[${MODULE}] FULL JSON RESPONSE:\n${fullRawResponse1}\n`);
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

      systemStatuses.set(projectId, { object: "", message: "READING File" });
      const stream2 = Orchestrator.handleUserInput(projectId, input2, llm);
      // let fullRawResponse2 = "";
      // const parser2 = new StreamParser();
      for await (const chunk of stream2) {
        if (chunk.res) {
          // fullRawResponse2 += chunk.res;
          // const parsedPart = parser2.parse(chunk.res);
          // if (parsedPart) {
          //   writeChunk({ res: parsedPart });
          // }
          writeChunk({ res: chunk.res });
        } else if (!chunk.done) {
          writeChunk(chunk);
        }
      }
      // logger.warn(`[${MODULE}] FULL JSON RESPONSE (READ RESULTS):\n${fullRawResponse2}\n`);
      writeChunk({ done: true });
      BaseActionEngine.ReadResults = [];   // clear after use
    }


    if (BaseActionEngine.sysResults.length && BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].type === "WRITE") {
      logger.info(`[${MODULE}] WRITE ACTION ENCOUNTERED`);
      const input3 = `This is the file you just created. 
\`\`\`
${BaseActionEngine.sysResults[BaseActionEngine.sysResults.length - 1].target}
\`\`\`
If any file remaining to be created then continue creating files.
If all the files in the current step is created then move to next step by responding:
{
    "res": "Moving to next step.",
    "actions": [
        {
            "type": "WORKFLOW",
            "target": "NEXT-STEP"
        }
    ]
}
`;

      const stream3 = Orchestrator.handleUserInput(projectId, input3, llm);
      // let fullRawResponse3 = "";
      // const parser3 = new StreamParser();
      for await (const chunk of stream3) {
        if (chunk.res) {
          // fullRawResponse3 += chunk.res;
          // const parsedPart = parser3.parse(chunk.res);
          // if (parsedPart) {
          //   writeChunk({ res: parsedPart });
          // }
          writeChunk({ res: chunk.res });
        } else if (!chunk.done) {
          writeChunk(chunk);
        }
      }
      // logger.warn(`[${MODULE}] FULL JSON RESPONSE (WRITE ACTIONS):\n${fullRawResponse3}\n`);
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
      const input3 = `${projectContext}\n\nIntroduce yourself and explain the current steps and what you will do.`;

      const stream4 = Orchestrator.handleUserInput(projectId, input3, llm);
      // let fullRawResponse4 = "";
      // const parser4 = new StreamParser();
      for await (const chunk of stream4) {
        if (chunk.res) {
          // fullRawResponse4 += chunk.res;
          // const parsedPart = parser4.parse(chunk.res);
          // if (parsedPart) {
          //   writeChunk({ res: parsedPart });
          // }
          writeChunk({ res: chunk.res });
        } else if (!chunk.done) {
          writeChunk(chunk);
        }
      }
      // logger.warn(`[${MODULE}] FULL JSON RESPONSE (WORKFLOW GREETING):\n${fullRawResponse4}\n`);
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