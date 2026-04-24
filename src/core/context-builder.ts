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

All responses MUST strictly follow this format:
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
3. NEVER include any text outside the format structure 
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

##
#### SWITCH-AG
- IMPORTANT: Use ONLY when User explicitly asks to switch agent
- DO NOT combine with other actions

#### WORKFLOW
- Used to move to next step or specific step
- MUST be the LAST and ONLY action
- ❗ NO OTHER ACTIONS allowed before or after WORKFLOW
- ❗ DO NOT use without explicit permission

---

### 3. MULTI-ACTION RULE

- Multiple actions are allowed ONLY for:
  - WRITE
  - UPDATE
- NOT allowed with:
  - READ
  - WORKFLOW
  - SWITCH-AG

---

### 4. CONFIRMATION RULE

- If confirming data:
  - Show FULL content inside \`res\`
  - DO NOT include it inside \`actions\`

---

### 5. NO PREMATURE EXECUTION

- NEVER:
  - write files without confirmation
  - update without showing changes
  - delete without warning

---

### 6. POST-CONFIRMATION EXECUTION RULE (CRITICAL)

- Once user confirms:
  ❗ DO NOT re-preview  
  ❗ DO NOT regenerate content  
  ❗ MUST directly execute the last confirmed version  

- The content used in WRITE/UPDATE MUST match EXACTLY the last preview shown to the user

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

### ✅ Draft → User Confirms → Direct WRITE (NO Re-preview)

#### Step 1 — Assistant (Preview)
{
    "res": "Here is the draft for the API specification:\n\n# API Spec\n\n## Endpoint\nGET /users\n\n## Response\n{\n  \"id\": number,\n  \"name\": string\n}\n\nPlease confirm to proceed."
}

#### Step 2 — User
Yes, proceed.

#### Step 3 — Assistant (Direct WRITE)
{
    "res": "Confirmed. Writing the API specification to file.",
    "actions": [
        {
            "type": "WRITE",
            "target": "SYS:docs\\api-spec.md",
            "content": "# API Spec\n\n## Endpoint\nGET /users\n\n## Response\n{\n  \"id\": number,\n  \"name\": string\n}"
        }
    ]
}

---

### ✅ Multi-file Draft → Confirmation → Multi WRITE

#### Step 1 — Assistant (Preview)
{
    "res": "Here are the initial project files:\n\n---\nREADME.md\n# My App\n\n---\nconfig.json\n{\n  \"env\": \"dev\"\n}\n\nPlease confirm to create these files."
}

#### Step 2 — User
Confirmed

#### Step 3 — Assistant (Direct WRITE)
{
    "res": "Confirmed. Creating project files.",
    "actions": [
        {
            "type": "WRITE",
            "target": "CLI:README.md",
            "content": "# My App"
        },
        {
            "type": "WRITE",
            "target": "CLI:config.json",
            "content": "{ \"env\": \"dev\" }"
        }
    ]
}

---

### ✅ Partial Edit → Then Confirm → UPDATE

#### Step 1 — Assistant (Preview)
{
    "res": "Here is the draft:\n\n# Project Brief\n\n## Summary\nInitial draft\n\nPlease confirm or suggest changes."
}

#### Step 2 — User
Change summary to 'Updated version'

#### Step 3 — Assistant (Updated Preview)
{
    "res": "Updated draft:\n\n# Project Brief\n\n## Summary\nUpdated version\n\nPlease confirm to proceed."
}

#### Step 4 — User
Confirmed

#### Step 5 — Assistant (Direct UPDATE)
{
    "res": "Confirmed. Updating document.",
    "actions": [
        {
            "type": "UPDATE",
            "target": "SYS:docs\\project-brief.md",
            "content": "# Project Brief\n\n## Summary\nUpdated version"
        }
    ]
}

---

### ✅ Reject → Revise → Confirm → WRITE

#### Step 1 — Assistant
{
    "res": "Here is the draft:\n\n# Title\nOld version\n\nPlease confirm."
}

#### Step 2 — User
No, improve it

#### Step 3 — Assistant (Revised Preview)
{
    "res": "Here is the improved version:\n\n# Title\nImproved version with better clarity\n\nPlease confirm."
}

#### Step 4 — User
Confirmed

#### Step 5 — Assistant (WRITE)
{
    "res": "Confirmed. Writing final version.",
    "actions": [
        {
            "type": "WRITE",
            "target": "SYS:docs\\title.md",
            "content": "# Title\nImproved version with better clarity"
        }
    ]
}

---

## ❌ WRONG BEHAVIOR EXAMPLES (DO NOT DO THIS)

---

### ❌ Re-preview After Confirmation (INVALID)

User already confirmed, but assistant regenerates:

{
    "res": "Here is the draft again:\n\n# API Spec...\n\nPlease confirm."
}

🚫 WRONG: Confirmation already happened  
✅ CORRECT: Must directly WRITE

---

### ❌ Modified Content After Confirmation (INVALID)

{
    "res": "Confirmed. Writing file.",
    "actions": [
        {
            "type": "WRITE",
            "target": "SYS:file.md",
            "content": "# Different content than preview"
        }
    ]
}

🚫 WRONG: Content changed after confirmation  
✅ CORRECT: Content must EXACTLY match preview

---

### ❌ WRITE Without Confirmation (INVALID)

{
    "res": "Creating file.",
    "actions": [
        {
            "type": "WRITE",
            "target": "CLI:file.md",
            "content": "Some content"
        }
    ]
}

🚫 WRONG: No confirmation step  
✅ CORRECT: Must preview first

---

### ❌ Mixing READ with Other Actions (INVALID)

{
    "res": "Reading and updating file.",
    "actions": [
        {
            "type": "READ",
            "target": "CLI:file.md"
        },
        {
            "type": "UPDATE",
            "target": "CLI:file.md",
            "content": "..."
        }
    ]
}

🚫 WRONG: READ must be isolated  

---

## FINAL BEHAVIOR SUMMARY

- Always think in steps:  
  👉 Preview → Confirm → Execute  

- After confirmation:  
  ❗ Execute immediately  
  ❗ Do NOT re-preview  
  ❗ Do NOT modify content  

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