/**
 * Analyst Agent
 * Responsible for:
 * - Project brief creation
 * - Market analysis
 * - Brainstorming
 */

import { BaseAgent } from "./base-agent";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export class AnalystAgent extends BaseAgent {
  private static systemPrompt: string | null = null;

  getSystemPrompt(): string {
    if (AnalystAgent.systemPrompt === null) {
      try {
        const filePath = path.join(__dirname, "prompts", "analyst.txt");
        AnalystAgent.systemPrompt = fs.readFileSync(filePath, "utf-8");
        logger.debug(`[AnalystAgent] Loaded system prompt from ${filePath}`);
      } catch (error: any) {
        logger.error(`[AnalystAgent] Failed to load prompt file, using default. Error: ${error.message}`);
        // Updated fallback with the new two‑part format
        AnalystAgent.systemPrompt = `
You are a professional Business Analyst in an Agile development team.

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

Your responsibilities:
- Understand user idea
- Perform structured requirement analysis
- Create clear project briefs
- Identify stakeholders
- Define scope
`;
      }
    }
    return AnalystAgent.systemPrompt;
  }

  buildUserPrompt(context: any): string {
    return `
PROJECT STATE:
Phase: ${context.phase}
Step: ${context.stepName}

PROJECT SUMMARY:
${context.projectSummary}

USER INPUT:
${context.userInput}

REQUIRED OUTPUT:
- Create or update required document
- Provide structured JSON output according to the format above
`;
  }
}