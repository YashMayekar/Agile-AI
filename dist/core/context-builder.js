"use strict";
/**
 * Context Builder
 *
 * Responsible for:
 * - Preparing structured context for agents
 * - Extracting relevant documents
 * - Adding summarized memory
 * - Keeping prompts clean and minimal
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextBuilder = void 0;
const project_state_repository_1 = require("./project-state/project-state.repository");
const workflow_engine_1 = require("./workflow-engine");
const logger_1 = require("../utils/logger");
const project_controller_1 = require("../api/project.controller");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MODULE = "context-builder.ts";
class ContextBuilder {
    static async getClientFS(projectId) {
        let fsTree = project_state_repository_1.ProjectStateRepository.load(projectId)?.dynamicContext.fileTree || undefined;
        if (!fsTree) {
            const res = await fetch("http://localhost:4500/data/tree");
            if (!res.ok) {
                throw new Error("Failed to fetch file tree");
            }
            fsTree = await res.json();
        }
        // write the fetched file tree into the state for future use
        const projectState = project_state_repository_1.ProjectStateRepository.load(projectId) || null;
        if (projectState) {
            projectState.dynamicContext.fileTree = fsTree;
            project_state_repository_1.ProjectStateRepository.save(projectId, projectState);
        }
        console.log("Fetched file tree:", JSON.stringify(fsTree));
        const result = [];
        function traverse(node, currentPath) {
            if (!node) {
                return;
            }
            if ("directory" in node) {
                const dirPath = currentPath
                    ? `${currentPath}/${node.directory}`
                    : node.directory;
                result.push(dirPath);
                for (const child of node.children) {
                    traverse(child, dirPath);
                }
            }
            else if ("file" in node) {
                const filePath = `${currentPath}/${node.file}`;
                result.push(filePath);
            }
        }
        traverse(fsTree, "");
        logger_1.logger.info(`[${MODULE}] Project Tree Fetched`);
        return result.join("\n");
    }
    static buildSteps(currentStepID) {
        logger_1.logger.info(`[${MODULE}] Building Steps...`);
        const currStep = workflow_engine_1.WorkflowEngine.getStepById(currentStepID);
        let steps = `
You are NOW at this step: **${currStep.name}**
${currStep.requires ? `At this step you require documents: **${currStep.requires}**\n` : ""}
${currStep.creates ? `At this step you will create documents: **${currStep.creates}**\n` : ""}
Complete the above step before moving to the next one.

`;
        const next_steps = workflow_engine_1.WorkflowEngine.getNextSteps(currentStepID);
        if (next_steps && next_steps.length > 0) {
            steps += `Here are the next steps in chronological order:\n`;
            for (const step of next_steps) {
                steps += `*Name: ${step.name}, Agent: ${step.agent}*\n`;
            }
            steps += `Do not execute any actions until you have completed the current step.\n`;
        }
        return steps;
    }
    static getAgentPrompt(agent) {
        const agentPath = path_1.default.join(__dirname, "..", "agents/prompts", `# ${agent}.md`);
        // logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
        const prompt = fs_1.default.readFileSync(agentPath, "utf-8");
        return prompt;
    }
    static buildFullContext(projectId, currentStepID, agent) {
        project_controller_1.systemStatuses.set(projectId, { object: "CONTEXT BUILDER", message: "BUILDING CONTEXT" });
        logger_1.logger.info(`[${MODULE}] Building Context...`);
        this.context = ` 
You are a part of a Agentic Agile Software development system.
As a ${agent} follow the next instructions carefully while maintaining a structured response format. 

${this.buildSteps(currentStepID)}

# This is your agent-specific prompt that you MUST follow strictly:
${this.getAgentPrompt(agent)}
`;
        return this.context;
    }
}
exports.ContextBuilder = ContextBuilder;
/**
 * Builds structured context object for agents.
 */
ContextBuilder.context = "";
