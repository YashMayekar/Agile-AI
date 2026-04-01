/**
 * Product Manager Agent
 * Responsible for:
 * - PRD creation
 * - Feature breakdown
 * - Backlog creation
 * - Sprint planning
 */

import { BaseAgent } from "./base-agent";

export class PMAgent extends BaseAgent {

  getSystemPrompt(): string {
    return `
You are a Senior Product Manager in an Agile team.

Responsibilities:
- Convert project brief into PRD
- Define functional requirements
- Define non-functional requirements
- Create user stories
- Define acceptance criteria

Always respond in STRICT JSON format.
No explanations outside JSON.
`;
  }

  buildUserPrompt(context: any): string {

    return `
PROJECT PHASE: ${context.phase}
CURRENT STEP: ${context.stepName}

AVAILABLE DOCUMENTS:
${JSON.stringify(context.documents, null, 2)}

USER INPUT:
${context.userInput}

Generate structured PRD or requested artifact.
`;
  }
}
