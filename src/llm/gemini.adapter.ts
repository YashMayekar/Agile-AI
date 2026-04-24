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

  public async GetSummary(projectId: string, input: string): Promise<string> {
      const systemPrompt = `You are a helpful assistant that summarizes project documents context without missing any important information for the user.`
      try {
        console.time('Response Time for Summary');
        systemStatuses.set(projectId, { object: "", message: `UNDERSTANDING INTENT` });
        const response = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: "gemma4:e4b",
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: input }
            ],
            stream: false,
            think: true,
            keep_alive: "50m",
            
          }),
  
        });
  
        const data = await response.json();
        console.log("Summary response:", data);
        console.timeEnd('Response Time for Summary');
        systemStatuses.set(projectId, { object: "", message: `DONE` });
        return data.message.content || "UNKNOWN";
      } catch (err) {
        logger.error(`[${MODULE}] Failed to detect workflow type: ${err}`);
        return { actions: [] } as any; // Return empty actions on error, treating it as UNKNOWN intent
      }
    }
  async GetWorkFlowType(projectId: string, input: string): Promise<any> {
    logger.info(`[${MODULE}] Fetching the project workflow type.`);

    const prompt = `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"`;
    const result = await this.model.generateContent(prompt);
    const response = result.response.text();

    logger.info(`[${MODULE}] RESPONSE GENERATED`);
    return response;
  }

  public async GetIntent(projectId: string, input: string, historyText: string): Promise<string> {
      
  
      let intent = `
  # Consider yourself as a medieator between the user and an AI agent. 
  # Your task is to analyze the user's input and the conversation history, and determine the user's intent based on that.
  # Carefully analyze your conversation history with the user and provide an structured output action:
  ${historyText}
  
  # According to the above conversation history and the current user input: "${input}", determine the user's intent.
  # If the user is confirming or approving any file or document contents from the previev then WRITE that file with the content that was previewed. The target should be should be determined based on the context.
  # Here is the output format:
  {
      "actions": [
          {
              "type": "WRITE",
              "target": "CLI:<path>" | "SYS:docs/<filename>.md",
              "content": "REQUIRED only for WRITE and UPDATE"
          }
      ]
  }
  
  # Anything else that does not indicate user confirmation or approval should be treated as "UNKNOWN".
  {
      "actions": []
  }`
  
      try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: intent }],
        stream: false,
        think: false,
        format:  {
          type: "object",
          properties: {
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  target: { type: "string" },
                  content: { type: "string" }
                },
                required: ["type", "target"]
              }
            }
          },
          required: ["actions"]
        },
       options: {
        temperature: 0,
       } 
      }),
    });
  
    const data = await response.json();
    return data.response || "UNKNOWN";
  
  } catch (err) {
    logger.error(`[${MODULE}] Failed to detect workflow type: ${err}`);
    return "DETECT_WORKFLOW_TYPE";
  }
    }
    
  async executeAction(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: {role: string, content: string}[] }): Promise<any> {
    logger.info(`[${MODULE}] TOTAL SIZE of INPUT: ${(params.systemPrompt).length + (params.userPrompt).length}`);
    logger.info(`[${MODULE}] Generating non-streaming response.`);

    const historyText = params.history ? params.history.map(h => `${h.role}: ${h.content}`).join("\n\n") : "";
    const dynamicText = params.dynamicContext ? `[CURRENT SYSTEM STATE & INSTRUCTIONS]\n${params.dynamicContext}\n\n` : "";
    const fullPrompt = `${params.systemPrompt}\n\n${historyText}\n\n${dynamicText}User: ${params.userPrompt}`;

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

  async *generate(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: {role: string, content: string}[] }): AsyncGenerator<{ res: string | null; tools?: any; think?: string | null; done: boolean }> {
    logger.info(`[${MODULE}] TOTAL SIZE of INPUT: ${(params.systemPrompt).length + (params.userPrompt).length}`);
    logger.info(`[${MODULE}] Connecting with the model: ${this.modelName}`);

    const historyText = params.history ? params.history.map(h => `${h.role}: ${h.content}`).join("\n\n") : "";
    const dynamicText = params.dynamicContext ? `[CURRENT SYSTEM STATE & INSTRUCTIONS]\n${params.dynamicContext}\n\n` : "";
    const fullPrompt = `${params.systemPrompt}\n\n${historyText}\n\n${dynamicText}User: ${params.userPrompt}`;

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