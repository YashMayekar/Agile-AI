"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentAnalyzer = void 0;
const logger_1 = require("../utils/logger");
const MODULE = "intent-analyzer.ts";
const INTENT_MODEL = "granite4:3b";
class IntentAnalyzer {
    static async analyze(userInput, clientTree) {
        logger_1.logger.info(`[${MODULE}] Analyzing intent with model: ${INTENT_MODEL}`);
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
        logger_1.logger.warn(`[${MODULE}] USER INPUT: ${userInput}\nSYSTEM PROMPT: ${systemPrompt}`);
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
                logger_1.logger.error(`[${MODULE}] Request failed: ${response.status}`);
                return [];
            }
            console.timeEnd('Intent Analysis time');
            const data = await response.json();
            const content = data.message?.content || "{}";
            const parsed = JSON.parse(content);
            if (parsed.actions && Array.isArray(parsed.actions)) {
                logger_1.logger.info(`[${MODULE}] Intent identified ${parsed.actions.length} PRE-ACTIONS.\nWhich are: ${JSON.stringify(parsed.actions)}`);
                return parsed.actions.map((act) => ({
                    type: act.type,
                    target: act.target,
                    content: ''
                }));
            }
            return [];
        }
        catch (error) {
            logger_1.logger.error(`[${MODULE}] Intent Analysis failed: ${error.message}`);
            return [];
        }
    }
}
exports.IntentAnalyzer = IntentAnalyzer;
