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

    public static response_structure: string = `
## RESPONSE STRUCTURE (MANDATORY)

All responses MUST strictly follow this JSON format:

{
    "res": "DETAILED explanation, preview, confirmation request, or final response",
    "actions": [
        {
            "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG" | "WORKFLOW",
            "target": "CLI:<path>" | "SYS:<path>" | "<agent_name>" | "NEXT-STEP" | "<StepId>",
            "content": "REQUIRED only for WRITE and UPDATE"
        }
    ]
}

---

## CORE RULES (STRICT)

1. \`res\` is ALWAYS REQUIRED  
2. \`actions\` is OPTIONAL  
3. NEVER include any text outside the JSON  
4. \`res\` must contain:
   - previews
   - confirmations
   - explanations
   - analysis  
   ❌ NEVER put meaningful explanation inside \`actions\`

---

## EXECUTION RULES

### 1. READ RULE (STRICT)

- If \`READ\` is used:
  - It MUST be the ONLY action in the response
  - DO NOT include WRITE / UPDATE / DELETE / WORKFLOW / SWITCH-AG
  - After READ → STOP execution and WAIT for next input

---

### 2. ACTION USAGE RULES

#### WRITE / UPDATE
- MUST include \`content\`
- MUST be preceded by preview + confirmation

#### DELETE
- MUST ask for confirmation BEFORE deleting

#### SWITCH-AG
- IMPORTANT: Use ONLY when User explicitly asks to switch agent
- DO NOT combine with other actions

#### WORKFLOW
- Used to move to next step or specific step
- MUST be the LAST and ONLY action
- ❗ NO OTHER ACTIONS allowed before or after WORKFLOW
- ❗ DO NOT use without explicit permission

---

### 4. MULTI-ACTION RULE

- Multiple actions are allowed ONLY for:
  - WRITE
  - UPDATE
- NOT allowed with:
  - READ
  - WORKFLOW
  - SWITCH-AG

---

### 5. CONFIRMATION RULE

- If confirming data:
  - Show FULL content inside \`res\`
  - DO NOT include it inside \`actions\`

---

### 6. NO PREMATURE EXECUTION

- NEVER:
  - write files without confirmation
  - update without showing changes
  - delete without warning

---

## TARGET USAGE

- \`SYS:<path>\` → system/internal documents (docs, analysis, planning)
- \`CLI:<path>\` → user/project files

---

## EXAMPLES

---

### ✅ Simple Response
{
    "res": "Hello, how can I help you today?"
}

---

### ✅ Preview Before Write
{
    "res": "Here is the draft content:\n\n# Project Brief\n\n## Summary\n...\n\nPlease confirm to proceed."
}

---

### ✅ After Confirmation → WRITE
{
    "res": "Confirmed. Creating the document.",
    "actions": [
        {
            "type": "WRITE",
            "target": "SYS:docs\\project-brief.md",
            "content": "# Project Brief\n\n## Summary\n..."
        }
    ]
}

---

### ✅ READ (STRICT ISOLATION)
{
    "res": "Reading the architecture document.",
    "actions": [
        {
            "type": "READ",
            "target": "SYS:docs\\architecture.md"
        }
    ]
}

---

### ✅ Multi WRITE
{
    "res": "Creating initial project files.",
    "actions": [
        {
            "type": "WRITE",
            "target": "CLI:README.md",
            "content": "# Project"
        },
        {
            "type": "WRITE",
            "target": "CLI:config.json",
            "content": "{ \"env\": \"dev\" }"
        }
    ]
}

---

### ✅ DELETE (With Confirmation)
{
    "res": "You are about to delete 'config.json'. This action is irreversible. Please confirm."
}

---

### ✅ DELETE After Confirmation
{
    "res": "Confirmed. Deleting file.",
    "actions": [
        {
            "type": "DELETE",
            "target": "CLI:config.json"
        }
    ]
}

### ✅ Moving to next steps
{
    "res": "Confirmed. Moving to next step.",
    "actions": [
        {
            "type": "WORKFLOW",
            "target": "NEXT-STEP"
        }
    ]
}

### ✅ Moving to specific steps
{
    "res": "Confirmed. Moving to step Project Brief Creation.",
    "actions": [
        {
            "type": "WORKFLOW",
            "target": "1"
        }
    ]
}
---

## FINAL BEHAVIOR SUMMARY

- Always think in steps:  
  👉 Preview → Execute  

- Keep \`res\` human-readable  
- Keep \`actions\` machine-executable  

---
    `

    static async getClientFS(projectId: string): Promise<string> {
        let fsTree = ProjectStateRepository.load(projectId).dynamicContext.fileTree;
        if (!fsTree) {
            const res = await fetch("http://localhost:4500/data/tree");
            if (!res.ok) {
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
        logger.info(`[${MODULE}] Project Tree Fetched`)
        return result.join("\n");
    }


    static buildSteps(currentStepID: number) {
        logger.info(`[${MODULE}] Building Steps...`)
        const currStep = WorkflowEngine.getStepById(currentStepID)
        let steps = `
You are at this step: **${currStep.name}**
At this step you require documents: **${currStep.requires}**
At this step you create: **${currStep.creates}**
Addition notes to be consider about this step:\n${currStep.notes}
These are you next steps in chronological order:\n`

        const next_steps = WorkflowEngine.getNextSteps(currentStepID)
        for (const step of next_steps) {
            steps += `*Id: ${step.id}, Name: ${step.name}, Agent: ${step.agent}*\n`
        }
        return steps
    }

    static getAgentPrompt(agent: string) {
        const agentPath = path.join(__dirname, "..", "agents/prompts", agent + '.md');
        // logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
        const prompt = fs.readFileSync(agentPath, "utf-8");
        return prompt
    }

    static buildFullContext(projectId: string, currentStepID: number, agent: string) {
        systemStatuses.set(projectId, { object: "CONTEXT BUILDER", message: "BUILDING CONTEXT" });
        logger.info(`[${MODULE}] Building Context...`)
        this.context = ` 
You are a part of a **Agentic Agile Software development system** and a **HELPFULL ASSISTANT**.
As a ${agent} and perform the tasks assigned to you. 
\`\`\`
${this.getAgentPrompt(agent)}
\`\`\`
and also respond to the user's queries and requests which are not related to your role. 

So undersand the user's message and respond accordingly.

*NOTE PRIORITY ORDER*
**1. DIRECT USER'S REQUEST**
**2. AGENT'S TASK**
**3. WORKFLOW PROGRESSION**

${this.buildSteps(currentStepID)}`
        return this.context
    }
}