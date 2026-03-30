import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { systemStatuses } from "../api/project.controller";
import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult } from "@google/generative-ai";

const MODULE = "gemini.adapter.ts";

// Optional: define the same response schema for structured output if Gemini supports it.
// Gemini can use responseMimeType = "application/json" and responseSchema.
// We'll use it in executeAction when format is needed.
const responseSchema = {
  type: 'object',
  properties: {
    res: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['READ', 'WRITE', 'UPDATE', 'DELETE', 'SWITCH-AG'] },
          target: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['type', 'target'],
        additionalProperties: false
      }
    }
  },
  required: ['res'],
  additionalProperties: false
};

export class GeminiAdapter implements LLMAdapter {
  private genAI: GoogleGenerativeAI;
  private modelName: string = "gemini-3-flash-preview"; // or "gemini-1.5-pro", etc.
  private model: GenerativeModel;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY is required for GeminiAdapter");
    }
    this.genAI = new GoogleGenerativeAI(key);
    this.model = this.genAI.getGenerativeModel({ model: this.modelName });
  }

  async GetWorkFlowType(projectId: string, input: string): Promise<any> {
    logger.info(`[${MODULE}] Fetching the project workflow type.`);

    const prompt = `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"`;
    const result = await this.model.generateContent(prompt);
    const response = result.response.text();

    logger.info(`[${MODULE}] RESPONSE GENERATED`);
    return response;
  }

  async executeAction(projectId: string, params: { systemPrompt: string; userPrompt: string }): Promise<any> {
  logger.info(`[${MODULE}] TOTAL SIZE of INPUT: ${(params.systemPrompt).length + (params.userPrompt).length}`);
  logger.info(`[${MODULE}] Generating non-streaming response.`);

  const fullPrompt = `${params.systemPrompt}\n\n${params.userPrompt}`;

  // Cast to any to bypass strict type checking for the schema
  const generationConfig: any = {
    responseMimeType: "application/json",
    responseSchema: responseSchema,
  };

  try {
    const result = await this.model.generateContent({
      contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
      generationConfig,
    });
    const responseText = result.response.text();
    try {
      return JSON.parse(responseText);
    } catch (e) {
      // If not JSON, return as string (though schema should enforce JSON)
      return responseText;
    }
  } catch (error) {
    logger.error(`[${MODULE}] Request failed: ${error}`);
    throw new Error(`Gemini request failed: ${error}`);
  }
}

  async *generate(projectId: string, params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<{ res: string | null; done: boolean }> {
    logger.info(`[${MODULE}] TOTAL SIZE of INPUT: ${(params.systemPrompt).length + (params.userPrompt).length}`);
    logger.info(`[${MODULE}] Connecting with the model: ${this.modelName}`);

    const fullPrompt = `${params.systemPrompt}\n\n${params.userPrompt}`;

    systemStatuses.set(projectId, { object: "", message: `CONNECTING TO ${this.modelName} model` });

    try {
      // Use streaming generation
      const result = await this.model.generateContentStream(fullPrompt);
      systemStatuses.set(projectId, { object: "LLM", message: 'RESPONDING' });

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          yield { res: chunkText, done: false };
        }
      }
      // Signal completion
      yield { res: null, done: true };
    } catch (error) {
      logger.error(`[${MODULE}] Streaming error: ${error}`);
      yield { res: null, done: true };
    }
  }
}