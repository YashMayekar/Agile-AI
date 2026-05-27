"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseActionEngine = void 0;
const path_1 = __importDefault(require("path"));
const logger_1 = require("../../utils/logger");
const project_state_repository_1 = require("../project-state/project-state.repository");
const read_action_1 = require("./read.action");
const write_action_1 = require("./write.action");
const delete_action_1 = require("./delete.action");
const update_action_1 = require("./update.action");
const switch_action_1 = require("./switch.action");
const workflow_action_1 = require("./workflow.action");
const MODULE = "base-engine.ts";
class BaseActionEngine {
    // --- Utility Methods (unchanged) ---
    static parseResponse(res) {
        logger_1.logger.debug(`[${MODULE}] Parsing LLM response...`);
        try {
            const trimmed = res.trim();
            // Strategy 1: Try to parse the whole trimmed string directly
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === "object") {
                    logger_1.logger.debug(`[${MODULE}] Direct JSON parse succeeded.`);
                    return parsed;
                }
            }
            catch {
                // Not a valid JSON object – continue to fallback strategies
            }
            // Strategy 2: Extract JSON from markdown code blocks
            const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/g;
            let match;
            while ((match = codeBlockRegex.exec(trimmed)) !== null) {
                try {
                    const parsed = JSON.parse(match[1].trim());
                    if (parsed && typeof parsed === "object") {
                        logger_1.logger.debug(`[${MODULE}] Extracted JSON from markdown code block.`);
                        return parsed;
                    }
                }
                catch {
                    // Continue searching for another code block
                }
            }
            // Strategy 3: Find the first '{' or '[' and extract a balanced JSON object/array
            const firstBraceIndex = trimmed.search(/[{\[]/);
            if (firstBraceIndex !== -1) {
                const jsonCandidate = this.extractBalancedJson(trimmed, firstBraceIndex);
                if (jsonCandidate) {
                    try {
                        const parsed = JSON.parse(jsonCandidate);
                        if (parsed && typeof parsed === "object") {
                            logger_1.logger.debug(`[${MODULE}] Extracted JSON using brace matching.`);
                            return parsed;
                        }
                    }
                    catch {
                        // Not valid JSON – fall through
                    }
                }
            }
            // If all strategies fail, throw an error
            throw new Error("No valid JSON object found in response");
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Failed to parse response: ${e.message}`);
            throw new Error("Invalid JSON response");
        }
    }
    /**
     * Extract a balanced JSON string starting at the given index.
     * Supports both objects `{...}` and arrays `[...]`.
     */
    static extractBalancedJson(str, startIdx) {
        const openChar = str[startIdx];
        const closeChar = openChar === '{' ? '}' : (openChar === '[' ? ']' : null);
        if (!closeChar)
            return null;
        let balance = 0;
        let inString = false;
        let escape = false;
        for (let i = startIdx; i < str.length; i++) {
            const ch = str[i];
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (!inString) {
                if (ch === openChar)
                    balance++;
                if (ch === closeChar)
                    balance--;
                if (balance === 0) {
                    return str.substring(startIdx, i + 1);
                }
            }
        }
        return null;
    }
    static getActions(res) {
        if (!res)
            return null;
        const response = this.parseResponse(res);
        if (response.actions && response.actions.length > 0) {
            logger_1.logger.info(`[${MODULE}] Actions Derived: ${JSON.stringify(response.actions)}`);
            return response.actions;
        }
        logger_1.logger.warn(`[${MODULE}] No actions found`);
        return null;
    }
    static getPath(input) {
        if (!input)
            return null;
        const match = input.match(/^(CLI|SYS):(.*)$/);
        if (!match)
            return null;
        return {
            device: match[1],
            path: match[2].trim(),
        };
    }
    static resolveSafePath(projectId, relativePath) {
        const projectPath = project_state_repository_1.ProjectStateRepository.getProjectPath(projectId);
        const resolved = path_1.default.resolve(projectPath, relativePath);
        logger_1.logger.debug(`[${MODULE}] Resolved path: ${resolved}`);
        return resolved;
    }
    static getAggregatedReadContext() {
        if (!this.ReadResults.length)
            return "";
        return `# READ ACTION RESULTS:
${this.ReadResults
            .map(r => `\`\`\`#${r.target}:\n${r.content}\`\`\``)
            .join("\n\n")}
`;
    }
    static getSkippedSteps() {
        if (!this.skippedSYSactions) {
            return "NO ACTIONS SKIPPED";
        }
        return `# SKIPPED ACTIONS:
${this.skippedSYSactions
            .map(ac => `# ${ac.type} - ${ac.target}`)
            .join("\n\n")}
    
`;
    }
    // --- Execution Orchestration ---
    static async executeActions(projectId, actions) {
        let readActionEncountered = false;
        if (!actions) {
            logger_1.logger.warn(`[${MODULE}] No actions to execute`);
            return { sysResults: [], cliActions: [] };
        }
        // Reset per‑cycle aggregation
        this.ReadResults = [];
        this.cliActions = [];
        this.sysResults = [];
        this.skippedSYSactions = [];
        for (const act of actions) {
            try {
                let safePath = "";
                if (this.FileActions.includes(act.type)) {
                    const parsedPath = this.getPath(act.target);
                    if (!parsedPath) {
                        logger_1.logger.warn(`[${MODULE}] Invalid target format: ${act.target}`);
                        continue;
                    }
                    // CLI actions: encode and store separately
                    if (parsedPath.device === "CLI") {
                        const encodedAction = {
                            type: act.type,
                            target: parsedPath.path,
                            content: Buffer.from(act.content || "").toString("base64"),
                        };
                        this.cliActions.push(encodedAction);
                        continue;
                    }
                    safePath = this.resolveSafePath(projectId, parsedPath.path);
                }
                else {
                    safePath = act.target;
                }
                // If Read request encountered then only perform read and skip the rest
                if (act.type === "READ") {
                    readActionEncountered = true;
                }
                if (readActionEncountered && act.type !== "READ") {
                    this.skippedSYSactions.push({
                        type: act.type,
                        target: act.target
                    });
                    continue;
                }
                // SYS actions: delegate to appropriate handler
                const handler = this.handlers.get(act.type);
                if (!handler) {
                    logger_1.logger.warn(`[${MODULE}] Unknown action type: ${act.type}`);
                    continue;
                }
                await handler.execute(projectId, safePath, act, {
                    aggregatedReadResults: this.ReadResults,
                    sysResults: this.sysResults,
                    cliActions: this.cliActions,
                });
            }
            catch (err) {
                logger_1.logger.error(`[${MODULE}] Action failed: ${err.message}`);
            }
        }
        //     if (this.aggregatedReadResults.length) {
        //       logger.info(`[${MODULE}] Updating the LLM with READ contents`)
        //       let llm = llmInstances.get(projectId);
        //       if (!llm) { llm = new OllamaAdapter(); }
        //       const input = `
        // These are the result of the READ request from previous response,
        // ${this.getAggregatedReadContext()}
        // And there might be some responses, that were skipped due to this READ actions:
        // ${this.getSkippedSteps()}
        // *See the CONVERSATION HISTORY* to know about what you were doing after reading,
        // and also consider any skipped ACTIONS.
        // RESPOND ACCORDINGLY
        // `
        //       console.log(`INPUT CREATED FROM READ:\n${input}`)
        //       const RES = await Orchestrator.handleSystemInput(projectId, input, llm);
        //       console.log("LLM OUTPUT:", RES.res);
        //       console.log("ACTIONS:", RES.actions);
        //     }
        //     this.aggregatedReadResults = []
        if (this.cliActions.length > 0) {
            try {
                await fetch("http://localhost:4500/actions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ actions: this.cliActions })
                });
                console.log(`CLI ACTIONS: ${JSON.stringify(this.cliActions)}`);
                logger_1.logger.info(`[${MODULE}] CLI actions successfully forwarded to client IDE.`);
            }
            catch (err) {
                logger_1.logger.error(`[${MODULE}] Failed to forward CLI actions to client IDE: ${err.message}`);
            }
        }
        return {
            sysResults: this.sysResults,
            cliActions: this.cliActions,
        };
    }
}
exports.BaseActionEngine = BaseActionEngine;
BaseActionEngine.sysResults = [];
BaseActionEngine.cliActions = [];
BaseActionEngine.skippedSYSactions = [];
BaseActionEngine.ReadResults = [];
BaseActionEngine.FileActions = ["READ", "WRITE", "DELETE", "UPDATE"];
BaseActionEngine.handlers = new Map([
    ["READ", new read_action_1.ReadHandler()],
    ["WRITE", new write_action_1.WriteHandler()],
    ["DELETE", new delete_action_1.DeleteHandler()],
    ["UPDATE", new update_action_1.UpdateHandler()],
    ["WORKFLOW", new workflow_action_1.WorkflowHandler()],
    ["SWITCH-AG", new switch_action_1.SwitchHandler()],
]);
