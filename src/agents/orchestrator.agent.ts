import { BaseAgent } from "./base-agent";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export class OrchestratorAgent extends BaseAgent {
  private static systemPrompt: string | null = null;

  getSystemPrompt(): string {
    if (OrchestratorAgent.systemPrompt === null) {
      try {
        const filePath = path.join(__dirname, "prompts", "orchestrator.txt");
        OrchestratorAgent.systemPrompt = fs.readFileSync(filePath, "utf-8");
        logger.debug(`[OrchestratorAgent] Loaded system prompt from ${filePath}`);
      } catch (error: any) {
        logger.error(`[OrchestratorAgent] Failed to load prompt file, using default. Error: ${error.message}`);
        // Updated fallback with the new two‑part format
        OrchestratorAgent.systemPrompt = `
You are Dev Manus, the Orchestrator Agent. Your job is to coordinate the multi‑agent system.

**Output Format (CRITICAL)**
You must respond in one of the following ways:

1. **For actions that do NOT carry file content** (e.g., RESPONSE, SWITCH-AGENT):
   \`\`\`
   {
       "device": "system" | "client",
       "action": "RESPONSE" | "SWITCH-AGENT",
       "path": "null",
       "message": "your message here",
       "content": "agent name" | "null"
   }
   \`\`\`

2. **For actions that DO carry file content** (WRITE, UPDATE):
   \`\`\`
   {
       "device": "system" | "client",
       "action": "WRITE" | "UPDATE",
       "path": "relative/path/to/file",
       "message": "short description"
   }
   \`\`\`
   <<<content>>>
   The actual file content (can be multiline, include quotes, etc.)
   <<<end-content>>>

**Rules**
- Do not add any extra text before or after the JSON/content block.
- For SWITCH-AGENT, put the agent name in the "content" field.
- For RESPONSE, "content" must be "null".
- The delimiters <<<content>>> and <<<end-content>>> must appear on their own lines.

**Your core responsibilities:**
- User‑centric development loop
- Phase‑aware execution
- Agent specialization respect
- Context preservation
- Output quality assurance
- Transparent process

**Agent registry:**
- Analyst (Ketan)    → Market Research, Competitive Analysis, Project Discovery
- PM (Afnan)         → Product Strategy, PRD Creation, Business Case
- Architect (Atharva) → System Design, Technology Selection, Architecture
- UX Expert (Om)     → User Research, UI/UX Design, Prototyping
- PO (Sainath)       → Backlog Management, Story Refinement, Acceptance Criteria
- SM (Aryan)         → Story Preparation, Sprint Planning, Process Facilitation
- Dev (Ayush)        → Implementation, Coding, Testing
- QA (Raunak)        → Quality Gates, Testing Strategy, Validation

**Phases:**
- PLAN: Analyst → PM
- DESIGN: Architect → UX Expert → PO
- DEVELOP: SM → Dev → QA
- TEST: QA

Always keep the user informed and in control.
`;
      }
    }
    return OrchestratorAgent.systemPrompt;
  }

  buildUserPrompt(context: any): string {
    return `
PROJECT STATE:
Mode: ${context.mode}
Phase: ${context.phase}
Current Step: ${context.stepName}
Documents: ${Object.keys(context.documents || {}).join(', ')}

PROJECT SUMMARY:
${context.projectSummary}

DYNAMIC CONTEXT:
${JSON.stringify(context.dynamicContext, null, 2)}

USER INPUT:
${context.userInput}

TASK:
- Greet the user appropriately based on the current state.
- Explain the current step and what is expected.
- If this is the start of a project, welcome the user and outline next steps.
- Provide clear instructions on what the user should do next.
- Keep response friendly and informative.
- do not show action format and types

Remember to output strictly in the required two‑part format.
`;
  }
}