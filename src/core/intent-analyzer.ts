import { logger } from "../utils/logger";
import { Action } from "./action-engine/base-engine";

const MODULE = "intent-analyzer.ts";
const INTENT_MODEL = "granite4:3b";

export class IntentAnalyzer {
  public static async analyze(userInput: string, clientTree: string): Promise<Action[]> {
    logger.info(`[${MODULE}] Analyzing intent with model: ${INTENT_MODEL}`);

    const systemPrompt = `You are a strict Intent Analyzer for an Agentic AI system.
Your goal is to identify if the user is asking to READ, WRITE, UPDATE, or DELETE specific files.

AVAILABLE ACTIONS:
- READ: Use this if the user wants you to look at, review, fix, or understand a specific file in the provided workspace.

RULES:
1. ALWAYS output your response as valid JSON matching the schema precisely.
2. Even if the user wants to UPDATE or FIX a file, you MUST return a READ action for that file first so the LLM has its contents.
3. NEVER return WRITE, DELETE, or UPDATE actions during this phase. ONLY READ or EMPTY ARRAY.
4. If no files need to be retrieved from the workspace, return an empty actions array.
5. If not sure about about the intent, return an empty actions array.
6. Prefix ALL targets with CLI: (e.g., target: "CLI:src/main.ts") unless it is an explicit CLI command.

# WORKSPACE TREE:
${clientTree}
`;

    const userPrompt = `User Request: ${userInput}\n\nWhat files need to be READ before proceeding? Respond in strict JSON.`;

    const responseSchema = {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['READ'] },
              target: { type: 'string' }
            },
            required: ['type', 'target']
          }
        }
      },
      required: ['actions']
    };

    logger.warn(`[${MODULE}] USER INPUT: ${userInput}\nSYSTEM PROMPT: ${systemPrompt}`);
    try {
      console.time('Intent Analysis time');
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: INTENT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          format: responseSchema,
        }),
      });

      if (!response.ok) {
        logger.error(`[${MODULE}] Request failed: ${response.status}`);
        return [];
      }

      console.timeEnd('Intent Analysis time');

      const data = await response.json();
      const content = data.message?.content || "{}";

      const parsed = JSON.parse(content);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        logger.info(`[${MODULE}] Intent identified ${parsed.actions.length} PRE-ACTIONS.\nWhich are: ${JSON.stringify(parsed.actions)}`);
        return parsed.actions.map((act: any) => ({
          type: act.type,
          target: act.target,
          content: ''
        }));
      }

      return [];
    } catch (error: any) {
      logger.error(`[${MODULE}] Intent Analysis failed: ${error.message}`);
      return [];
    }
  }
}
