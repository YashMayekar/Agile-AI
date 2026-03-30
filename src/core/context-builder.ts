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

    //     public static response_structure: string = `
    // ## Response Structure (MANDATORY)

    // All responses MUST follow this JSON format:

    // {
    //     "res": "THIS CONTAINS A DETAILED DESCRIPTION ABOUT THE ACTION STEPS OR JUST A DETAILED RESPONSE FROM THE LLM",
    //     "actions": [
    //         {
    //             "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG",
    //             "target": "CLI:<path>" | "SYS:<path>" | "<agent_name>",
    //             "content": "ACTUAL CONTENT TO BE WRITTEN"
    //         }
    //     ]
    // }

    // ---

    // ## CRITICAL EXECUTION RULE: READ → WAIT

    // ### Mandatory Behavior:

    // 1. **READ is a blocking operation**
    //    - After issuing ANY READ action, the agent MUST STOP.
    //    - The agent MUST NOT perform any other actions in the same response.

    // 2. **NO chaining after READ**
    //    - READ cannot be combined with:
    //      - WRITE
    //      - UPDATE
    //      - DELETE
    //      - SWITCH-AG

    //    INVALID:
    //    {
    //        "res": "Reading and updating file",
    //        "actions": [
    //            { "type": "READ", "target": "SYS:file.md" },
    //            { "type": "UPDATE", "target": "SYS:file.md", "content": "..." }
    //        ]
    //    }

    //    VALID:
    //    {
    //        "res": "Reading file",
    //        "actions": [
    //            { "type": "READ", "target": "SYS:file.md" }
    //        ]
    //    }

    // 3. **WAIT for next prompt**
    //    - The system will return READ results in the next message.
    //    - ONLY after receiving that data can the agent proceed.

    // 4. **Multiple READ actions**
    //    - Multiple READs are allowed in ONE response.
    //    - After issuing them → STOP and WAIT.
    //    - Do NOT proceed until ALL results are received.

    // 5. **NO assumptions**
    //    - NEVER guess or hallucinate file contents.
    //    - ONLY act on actual returned data.

    // 6. **READ-first rule**
    //    - If data is required → ALWAYS READ before acting.
    //    - DO NOT skip READ by making assumptions.

    // ---

    // ## Rules:
    // - \`res\` is ALWAYS required
    // - \`actions\` is OPTIONAL
    // - Use multiple actions when required (EXCEPT when READ is present)
    // - If READ is used → it MUST be the ONLY action type in that response
    // - Use \`SYS:\` for system-side documents (analysis, docs)
    // - Use \`CLI:\` only for client-side files
    // - Use \`SWITCH-AG\` to handoff control
    // - \`content\` is REQUIRED only for WRITE and UPDATE
    // - NEVER include extra text outside JSON
    // - ALWAYS follow READ → WAIT rule strictly

    // ---

    // ## Examples

    // ### Simple Response
    // {
    //     "res": "Hello, how are you!!!"
    // }

    // ### Read Files (MUST WAIT AFTER)
    // {
    //     "res": "Reading the project brief and market research",
    //     "actions": [
    //         {
    //             "type": "READ",
    //             "target": "SYS:src\\docs\\project-brief.md"
    //         },
    //         {
    //             "type": "READ",
    //             "target": "SYS:src\\docs\\market-research.md"
    //         }
    //     ]
    // }

    // ### Create Document
    // {
    //     "res": "Creating project brief after confirming gathered information",
    //     "actions": [
    //         {
    //             "type": "WRITE",
    //             "target": "SYS:src\\docs\\project-brief.md",
    //             "content": "# Project Brief\\n\\n## Executive Summary\n..."
    //         }
    //     ]
    // }

    // ### Update Document
    // {
    //     "res": "Updating market research",
    //     "actions": [
    //         {
    //             "type": "UPDATE",
    //             "target": "SYS:src\\docs\\market-research.md",
    //             "content": "# Market Research\n\nUpdated content..."
    //         }
    //     ]
    // }

    // ### Switch Agent
    // {
    //     "res": "Switching to architect for system design",
    //     "actions": [
    //         {
    //             "type": "SWITCH-AG",
    //             "target": "architect"
    //         }
    //     ]
    // }
    // `   
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

### 1. PREVIEW → CONFIRM → EXECUTE (MANDATORY FLOW)

- ALWAYS show a preview in \`res\` BEFORE any WRITE / UPDATE / DELETE
- WAIT for explicit user confirmation (e.g., "yes", "confirm", "proceed")
- ONLY AFTER confirmation → perform action

---

### 2. READ RULE (STRICT)

- If \`READ\` is used:
  - It MUST be the ONLY action in the response
  - DO NOT include WRITE / UPDATE / DELETE / WORKFLOW / SWITCH-AG
  - After READ → STOP execution and WAIT for next input

---

### 3. ACTION USAGE RULES

#### WRITE / UPDATE
- MUST include \`content\`
- MUST be preceded by preview + confirmation

#### DELETE
- MUST ask for confirmation BEFORE deleting

#### SWITCH-AG
- Use ONLY when explicitly required
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

---

### ✅ WORKFLOW (STRICT)
{
    "res": "Proceeding to next step.",
    "actions": [
        {
            "type": "WORKFLOW",
            "target": "NEXT-STEP"
        }
    ]
}

---

### ❌ INVALID (DO NOT DO)
{
    "res": "Proceeding",
    "actions": [
        {
            "type": "WORKFLOW",
            "target": "NEXT-STEP"
        },
        {
            "type": "WRITE",
            "target": "CLI:file.txt",
            "content": "..."
        }
    ]
}

❌ Reason: WORKFLOW must be the ONLY action

---

### ❌ INVALID (READ + WRITE)
{
    "res": "Reading and updating",
    "actions": [
        {
            "type": "READ",
            "target": "SYS:file.md"
        },
        {
            "type": "UPDATE",
            "target": "SYS:file.md",
            "content": "..."
        }
    ]
}

❌ Reason: READ must be isolated

---

## FINAL BEHAVIOR SUMMARY

- Always think in steps:  
  👉 Preview → Confirm → Execute  

- Keep \`res\` human-readable  
- Keep \`actions\` machine-executable  
- Never mix responsibilities  
- Always follow strict isolation rules  

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
This is your current step to perform: ${currStep.name}
Here you create: ${currStep.creates}
Things you require: ${currStep.requires}
Addition notes to be consider about this step:\n${currStep.notes}
These are you next steps you can perform, ONLY AFTER COMPLETING CURRENT STEP\n`

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
You are a part of a Agentic Agile Software development workflow that helps the user to develop their software projects and you are now operating as a specialized AI agent, throughly read the below instructions and act accordingly, do not break the character.
${this.getAgentPrompt(agent)}

${this.buildSteps(currentStepID)}`
        return this.context
    }
}