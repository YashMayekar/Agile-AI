/**
 * Context Builder
 *
 * Responsible for:
 * - Preparing structured context for agents
 * - Extracting relevant documents
 * - Adding summarized memory
 * - Keeping prompts clean and minimal
 */

import { ProjectState, FileTreeNode } from "./project-state/project-state.model";
import { ProjectStateRepository } from "./project-state/project-state.repository";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";
import { logger } from "../utils/logger";
import { MemoryManager } from "./memory-manager";
import fs from "fs";
import path from "path";
const MODULE = "context-builder.ts";

export class ContextBuilder {

  /**
   * Builds structured context object for agents.
   */

  private static context: string = ""

  public static response_structure: string = `
## Response Structure (MANDATORY)

All responses MUST follow this JSON format:

{
    "res": "THIS CONTAINS A DETAIL DESCRIPTION ABOUT THE ACTION STEPS OR JUST A DETALED RESPONSE FROM THE LLM",
    "actions": [
        {
            "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG",
            "target": "CLI:<path>" | "SYS:<path>" | "<agent_name>",
            "content": "ACTUAL CONTENT TO BE WRITTEN"
        }
    ]
}


### Rules:
- \`res\` is ALWAYS required
- \`actions\` is OPTIONAL
- Use multiple actions when required
- Use \`SYS:\` for system-side documents (analysis, docs)
- Use \`CLI:\` only for client-side files
- Use \`SWITCH-AG\` to handoff control
- \`content\` is REQUIRED only for WRITE and UPDATE
- NEVER include extra text outside JSON

---

## Examples

### Simple Response
{
    "res": "Hello, how are you!!!"
}


### Read Files
{
    "res": "Reading the project brief and market research",
    "actions": [
        {
            "type": "READ",
            "target": "SYS:src\\docs\\project-brief.md"
        },
        {
            "type": "READ",
            "target": "SYS:src\\docs\\market-research.md"
        }
    ]
}

### Create Document, before creating any documents, confirm the information you gathered
{
    "res": "Creating project brief",
    "actions": [
        {
            "type": "WRITE",
            "target": "SYS:src\\docs\\project-brief.md",
            "content": "# Project Brief\\n\\n## Executive Summary\n..."
        }
    ]
}

### Update Document
{
    "res": "Updating market research",
    "actions": [
        {
            "type": "UPDATE",
            "target": "SYS:src\\docs\\market-research.md",
            "content": "# Market Research\n\nUpdated content..."
        }
    ]
}

### Switch Agent
{
    "res": "Switching to architect for system design",
    "actions": [
        {
            "type": "SWITCH-AG",
            "target": "architect"
        }
    ]
}
`

  static build(state: ProjectState, currentStep: WorkflowStep, userInput: string) {
  logger.debug(`[${MODULE}] Building context for step ${currentStep.id}, project ${state.projectId}`);

  const context = {
    projectId: state.projectId,
    mode: state.mode,
    phase: state.phase,
    stepId: state.currentStepId,
    stepName: currentStep.name,
    stepAgent: currentStep.agent,
    documents: state.documents,
    projectSummary: state.contextMemory?.summary || "",
    decisions: state.contextMemory?.decisions || [],
    architectureNotes: state.contextMemory?.architectureNotes || [],
    dynamicContext: state.dynamicContext || { stories: [], currentStoryIndex: 0, qaLeftUnchecked: false },
    fileTree: state.dynamicContext?.fileTree, // expose tree to agent
    userInput
  };

  logger.debug(`[${MODULE}] Context built`);
  return context;
  }

  static async getClientFS(projectId: string): Promise<string> {
    let fsTree = ProjectStateRepository.load(projectId).dynamicContext.fileTree;
   
    if(!fsTree){
        const res = await fetch("http://localhost:4500/data/tree");
        if (!res.ok){
            throw new Error("Failed to fetch file tree");   
        }
        fsTree = await res.json()
    }

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

    return result.join("\n");
  }


  static buildSteps(currentStepID: number){
    const currStep = WorkflowEngine.getStepById(currentStepID)
    let steps = `
    This is your current step to perform\n${currStep.name}
    \nHere u need to create: ${currStep.creates}
    \nFor that you require: ${currStep.requires}
    \nAddition notes to be consider about this step:\n${currStep.notes}
    These are you next steps you can perform, ONLY AFTER COMPLETING CURRENT STEP`
    
    const next_steps = WorkflowEngine.getNextSteps(currentStepID)
    for (const step of next_steps) {
        steps += `Step Id: ${step.id}, Step Name: ${step.name}`
    }
    return steps
  }

  static getAgentPrompt(agent: string){
    const agentPath = path.join(__dirname, "..", "agents/prompts", agent+'.md');
    // logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
    const prompt = fs.readFileSync(agentPath, "utf-8");
    return prompt          
  }

  static buildFullContext(projectId:string, currentStepID: number, agent: string){
    this.context = ` 
      You are a part of a Agentic Agile Software development workflow that helps the user to develop their software projects and you are now operating as a specialized AI agent, throughly read the below instructions and act accordingly, do not break the character.
      ${this.getAgentPrompt(agent)}

      Here is the whole context, by considering this you should respond
      ${this.buildSteps}

      This is the last few conversation that you should remember,
      ${MemoryManager.getLastNConversations(projectId, 2)}
      `
    return this.context
  }
}