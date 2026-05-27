/**
 * Context Builder
 *
 * Responsible for:
 * - Preparing structured context for agents
 * - Extracting relevant documents
 * - Adding summarized memory
 * - Keeping prompts clean and minimal
 */

import { FileTreeNode } from "./project-state/project-state.model";
import { ProjectStateRepository } from "./project-state/project-state.repository";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";
import { logger } from "../utils/logger";
import { systemStatuses } from "../api/project.controller";
import fs from "fs";
import path from "path";

const MODULE = "context-builder.ts";

export class ContextBuilder {

    /**
     * Builds structured context object for agents.
     */
    private static context: string = ""


    static async getClientFS(projectId: string): Promise<string> {
        let fsTree = ProjectStateRepository.load(projectId)?.dynamicContext.fileTree || undefined as FileTreeNode | undefined;
        if (!fsTree) {
            const res = await fetch("http://localhost:4500/data/tree");
            if (!res.ok) {
                throw new Error("Failed to fetch file tree");
            }
            fsTree = await res.json()
        }
        // write the fetched file tree into the state for future use
        const projectState = ProjectStateRepository.load(projectId) || null;
        if (projectState) {
            projectState.dynamicContext.fileTree = fsTree;
            ProjectStateRepository.save(projectId, projectState);
        }
        console.log("Fetched file tree:", JSON.stringify(fsTree));
        const result: string[] = [];
        function traverse(node: FileTreeNode | undefined, currentPath: string) {
            if (!node) { return }
            if ("directory" in node) {
                const dirPath = currentPath
                    ? `${currentPath}/${node.directory}`
                    : node.directory;

                result.push(dirPath);

                for (const child of node.children) {
                    traverse(child, dirPath);
                }
            } else if ("file" in node) {
                const filePath = `${currentPath}/${node.file}`;
                result.push(filePath);
            }
        }
        traverse(fsTree, "");
        logger.info(`[${MODULE}] Project Tree Fetched`)
        return result.join("\n");
    }


    static buildSteps(currentStepID: number) {
        logger.info(`[${MODULE}] Building Steps...`)
        const currStep = WorkflowEngine.getStepById(currentStepID)
        let steps = `
You are NOW at this step: **${currStep.name}**
${ currStep.requires ? `At this step you require documents: **${currStep.requires}**\n` : "" }
${ currStep.creates ? `At this step you will create documents: **${currStep.creates}**\n` : "" }
Complete the above step before moving to the next one.

`

        const next_steps = WorkflowEngine.getNextSteps(currentStepID)
        if (next_steps && next_steps.length > 0) {
            steps += `Here are the next steps in chronological order:\n`
            for (const step of next_steps) {
                steps += `*Name: ${step.name}, Agent: ${step.agent}*\n`
            }
            steps += `Do not execute any actions until you have completed the current step.\n`
        }
        return steps
    }

    static getAgentPrompt(agent: string) {
        const agentPath = path.join(__dirname, "..", "agents/prompts", `# ${agent}.md`);
        // logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
        const prompt = fs.readFileSync(agentPath, "utf-8");
        return prompt
    }

    static buildFullContext(projectId: string, currentStepID: number, agent: string) {
        systemStatuses.set(projectId, { object: "CONTEXT BUILDER", message: "BUILDING CONTEXT" });
        logger.info(`[${MODULE}] Building Context...`)
        this.context = ` 
You are a part of a Agentic Agile Software development system.
As a ${agent} follow the next instructions carefully while maintaining a structured response format. 

${this.buildSteps(currentStepID)}

# This is your agent-specific prompt that you MUST follow strictly:
${this.getAgentPrompt(agent)}
`
        
        return this.context
    }
}