"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectAbortControllers = exports.systemStatuses = exports.llmInstances = void 0;
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const file_system_1 = require("../utils/file-system");
const logger_1 = require("../utils/logger");
const orchestrator_1 = require("../core/orchestrator");
const ollama_adapter_1 = require("../llm/ollama.adapter");
const base_engine_1 = require("../core/action-engine/base-engine");
const project_state_repository_1 = require("../core/project-state/project-state.repository");
const MODULE = "project.controller.ts";
const router = express_1.default.Router();
/* =========================================================
   STREAM PARSER
========================================================= */
class StreamParser {
    constructor() {
        this.buffer = "";
        this.state = "SEEKING_RES";
        this.escapeNext = false;
    }
    parse(chunk) {
        let output = "";
        for (let i = 0; i < chunk.length; i++) {
            const char = chunk[i];
            if (this.state === "SEEKING_RES") {
                this.buffer += char;
                if (this.buffer.endsWith('"res"')) {
                    this.state = "WAITING_COLON";
                }
            }
            else if (this.state === "WAITING_COLON") {
                if (char === '"') {
                    this.state = "INSIDE_RES";
                }
            }
            else if (this.state === "INSIDE_RES") {
                if (this.escapeNext) {
                    if (char === "n")
                        output += "\n";
                    else if (char === "r")
                        output += "\r";
                    else if (char === "t")
                        output += "\t";
                    else if (char === "b")
                        output += "\b";
                    else if (char === "f")
                        output += "\f";
                    else
                        output += char;
                    this.escapeNext = false;
                }
                else if (char === "\\") {
                    this.escapeNext = true;
                }
                else if (char === '"') {
                    this.state = "DONE";
                }
                else {
                    output += char;
                }
            }
        }
        return output;
    }
}
exports.llmInstances = new Map();
exports.systemStatuses = new Map();
exports.projectAbortControllers = new Map();
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
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        const currentStep = project_state_repository_1.ProjectStateRepository.load(projectId)?.currentStepName ||
            "unknown";
        const status = exports.systemStatuses.get(projectId) || {
            object: "SYSTEM",
            message: "IDLE"
        };
        const currentAgent = project_state_repository_1.ProjectStateRepository.load(projectId)?.currentAgent ||
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
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        try {
            logger_1.logger.info(`[${MODULE}] HISTORY_REQUESTED`);
            const historyPath = path_1.default.join("projects", projectId, "history.json");
            if (file_system_1.FileSystem.exists(historyPath)) {
                const history = file_system_1.FileSystem.readJSON(historyPath);
                res.json(history);
                logger_1.logger.info(`[${MODULE}] HISTORY_SENT`);
            }
            else {
                res.json([]);
                logger_1.logger.warn(`[${MODULE}] HISTORY_NOT_FOUND`);
            }
        }
        catch (err) {
            logger_1.logger.error(`[${MODULE}] HISTORY_READ_FAILED`, {
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
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        try {
            logger_1.logger.info(`[${MODULE}] ABORT_REQUESTED`);
            const abortController = exports.projectAbortControllers.get(projectId);
            if (abortController) {
                abortController.abort();
                exports.projectAbortControllers.delete(projectId);
                logger_1.logger.info(`[${MODULE}] ABORT_SIGNAL_SENT`);
                res.json({ message: `Processes for project ${projectId} aborted` });
            }
            else {
                logger_1.logger.warn(`[${MODULE}] NO_ACTIVE_PROCESS_TO_ABORT`);
                res.status(404).json({ error: "No active process found for this project" });
            }
        }
        catch (err) {
            logger_1.logger.error(`[${MODULE}] ABORT_FAILED`, {
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
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        try {
            logger_1.logger.info(`[${MODULE}] DELETE_REQUESTED`);
            // Abort any running streams for this project
            const abortController = exports.projectAbortControllers.get(projectId);
            if (abortController) {
                abortController.abort();
                await new Promise(resolve => setTimeout(resolve, 500)); // grace period
                exports.projectAbortControllers.delete(projectId);
            }
            const projectPath = path_1.default.join("projects", projectId);
            if (file_system_1.FileSystem.exists(projectPath)) {
                file_system_1.FileSystem.deleteDir(projectPath);
                exports.llmInstances.delete(projectId);
                exports.systemStatuses.delete(projectId);
                logger_1.logger.info(`[${MODULE}] PROJECT_DELETED`);
                res.json({ message: `Project ${projectId} deleted successfully` });
            }
            else {
                logger_1.logger.warn(`[${MODULE}] PROJECT_NOT_FOUND`);
                res.status(404).json({ error: "Project not found" });
            }
        }
        catch (err) {
            logger_1.logger.error(`[${MODULE}] DELETE_FAILED`, {
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
    const projectId = (0, uuid_1.v4)();
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        try {
            logger_1.logger.info(`[${MODULE}] PROJECT_INITIALIZATION_STARTED`);
            const projectPath = path_1.default.join("projects", projectId);
            file_system_1.FileSystem.ensureDir(projectPath);
            file_system_1.FileSystem.ensureDir(path_1.default.join(projectPath, "docs"));
            const initialState = {
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
            const initialHistory = [];
            file_system_1.FileSystem.writeJSON(path_1.default.join(projectPath, "state.json"), initialState);
            file_system_1.FileSystem.writeJSON(path_1.default.join(projectPath, "history.json"), initialHistory);
            const llm = new ollama_adapter_1.OllamaAdapter();
            exports.llmInstances.set(projectId, llm);
            logger_1.logger.info(`[${MODULE}] PROJECT_INITIALIZED`);
            res.json({ projectId });
        }
        catch (err) {
            logger_1.logger.error(`[${MODULE}] PROJECT_INITIALIZATION_FAILED`, {
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
    await (0, logger_1.withProjectLogging)(projectId, async () => {
        res.setHeader("Content-Type", "application/json");
        const { userInput, planning } = req.body;
        logger_1.logger.info(`[${MODULE}] MESSAGE_STREAM_STARTED`);
        let llm = exports.llmInstances.get(projectId);
        if (!llm) {
            logger_1.logger.warn(`[${MODULE}] LLM_INSTANCE_NOT_FOUND`);
            llm = new ollama_adapter_1.OllamaAdapter();
            exports.llmInstances.set(projectId, llm);
            logger_1.logger.info(`[${MODULE}] NEW_LLM_INSTANCE_CREATED`);
        }
        const writeChunk = (data) => {
            res.write(JSON.stringify(data) + "\n");
        };
        // Create abort controller for this stream
        const abortController = new AbortController();
        exports.projectAbortControllers.set(projectId, abortController);
        const cleanup = () => {
            if (exports.projectAbortControllers.get(projectId) === abortController) {
                exports.projectAbortControllers.delete(projectId);
            }
        };
        req.on("close", cleanup);
        req.on("error", cleanup);
        try {
            /* =====================================================
               PRIMARY STREAM
            ===================================================== */
            logger_1.logger.info(`[${MODULE}] PRIMARY_STREAM_STARTED`);
            const stream1 = orchestrator_1.Orchestrator.handleUserInput(projectId, userInput, llm, planning, abortController.signal);
            const parser1 = new StreamParser();
            for await (const chunk of stream1) {
                if (abortController.signal.aborted) {
                    throw new Error("Aborted by user or system");
                }
                if (chunk.res || chunk.think) {
                    const out = {};
                    if (chunk.res) {
                        if (!planning) {
                            out.res = parser1.parse(chunk.res);
                        }
                        else {
                            out.res = chunk.res;
                        }
                    }
                    if (chunk.think)
                        out.think = chunk.think;
                    writeChunk(out);
                }
                else if (!chunk.done) {
                    writeChunk(chunk);
                }
            }
            writeChunk({ done: true });
            logger_1.logger.info(`[${MODULE}] PRIMARY_STREAM_COMPLETED`);
            /* =====================================================
               WORKFLOW GREETING (if needed)
            ===================================================== */
            if (base_engine_1.BaseActionEngine.sysResults.length &&
                base_engine_1.BaseActionEngine.sysResults[base_engine_1.BaseActionEngine.sysResults.length - 1].type === "WORKFLOW") {
                logger_1.logger.info(`[${MODULE}] WORKFLOW_ACTION_DETECTED`);
                writeChunk({ status: "Preparing project context..." });
                const workflowPrompt = `
WORKFLOW CHANGE DETECTED:
Now you act as if you are greeting the user for the new workflow step.
Tell the user what you can do for them in this step in short and concise manner.
If you have any questions for the user to clarify before starting the step, ask them now.
        `;
                const stream2 = orchestrator_1.Orchestrator.handleSystemInput(projectId, workflowPrompt, llm, abortController.signal);
                for await (const chunk of stream2) {
                    if (abortController.signal.aborted) {
                        throw new Error("Aborted by user or system");
                    }
                    if (chunk.res || chunk.think) {
                        const out = {};
                        if (chunk.res)
                            out.res = chunk.res;
                        if (chunk.think)
                            out.think = chunk.think;
                        writeChunk(out);
                    }
                    else if (!chunk.done) {
                        writeChunk(chunk);
                    }
                }
                writeChunk({ done: true });
                logger_1.logger.info(`[${MODULE}] WORKFLOW_GREETING_COMPLETED`);
                base_engine_1.BaseActionEngine.sysResults[base_engine_1.BaseActionEngine.sysResults.length - 1].type = "NONE";
            }
            base_engine_1.BaseActionEngine.sysResults.push({ type: "NONE", target: "", content: "" });
            logger_1.logger.info(`[${MODULE}] MESSAGE_STREAM_COMPLETED`);
        }
        catch (error) {
            if (error.message === "Aborted by user or system") {
                logger_1.logger.warn(`[${MODULE}] STREAM_ABORTED for project ${projectId}`);
                writeChunk({ done: true, aborted: true, message: "Operation cancelled." });
            }
            else {
                logger_1.logger.error(`[${MODULE}] MESSAGE_STREAM_FAILED`, {
                    error: error?.message,
                    stack: error?.stack
                });
                if (!res.headersSent) {
                    res.status(500).json({ error: error.message });
                }
                else {
                    writeChunk({ error: error.message });
                }
            }
        }
        finally {
            res.end();
            cleanup();
            logger_1.logger.info(`[${MODULE}] RESPONSE_CLOSED`);
        }
    });
});
exports.default = router;
