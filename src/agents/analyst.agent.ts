/**
 * Analyst Agent
 * Responsible for:
 * - Project brief creation
 * - Market analysis
 * - Brainstorming
 */

import { BaseAgent } from "./base-agent";

export class AnalystAgent extends BaseAgent {

  getSystemPrompt(): string {
    return `
You are a professional Business Analyst in an Agile development team.

Responsibilities:
- Understand user idea
- Perform structured requirement analysis
- Create clear project briefs
- Identify stakeholders
- Define scope

You MUST respond in strict JSON format according to system schema.
Do NOT output plain text.
`;
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
- Provide structured JSON output
`;
  }
}
