import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { ContextBuilder } from "../core/context-builder";
import { systemStatuses } from "../api/project.controller";

const MODULE = "ollama.adapter.ts"

// qwen3.5:9b
// mistral:latest
// analyst-gpt:1-0
// qwen3:30b
// cogito:8b
// qwen3-coder:30b
// deepseek-r1:8b
// gpt-oss:20b
// llama3.1:8b

// Define the JSON schema matching your response_structure
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


export class OllamaAdapter implements LLMAdapter {
  private model: string = "gpt-oss:20b";

  // gpt-oss:20b
  //ministral-3:14b

  async GetWorkFlowType(projectId: string, input: string): Promise<any> {

    let thinking: string | boolean = false;

    if (this.model === "gpt-oss:20b") {
      thinking = "low";
    }
    logger.info(`[${MODULE}] Fetching the project workflow type.`)
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"`,
        stream: false,
        think: thinking,
      }),
    });
    if (!response.ok) {
      logger.error(`[${MODULE}] Request failed: ${response.status}`)
      throw new Error(`Request failed: ${response.status}`);
    }

    logger.info(`[${MODULE}] RESPONSE GENERATED`)
    const data = await response.json();
    return data.response;
  }

  async executeAction(projectId: string, params: { systemPrompt: string; userPrompt: string }): Promise<any> {

    let thinking: string | boolean = true;

    if (this.model === "gpt-oss:20b") {
      thinking = "medium";
    }
    logger.info(`[${MODULE}] TOTAL SIZE of INPUT:${(params.systemPrompt).length + (params.userPrompt).length}`)
    logger.info(`[${MODULE}] Generating non-streaming response.`)
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: params.systemPrompt,
        prompt: params.userPrompt,
        stream: false,
        "think": thinking,
        format: responseSchema
      }),
    });
    if (!response.ok) {
      logger.error(`[${MODULE}] Request failed: ${response.status}`)
      throw new Error(`Request failed: ${response.status}`);
    }

    logger.info(`[${MODULE}] RESPONSE GENERATED`)
    const data = await response.json();
    return data.message.content;
  }


  async *generate(projectId: string, params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<{ res: string | null; done: boolean }> {

    let thinking: string | boolean = false;

    if (this.model === "gpt-oss:20b") {
      thinking = "medium";
    }

    logger.info(`[${MODULE}] TOTAL SIZE of INPUT:${(params.systemPrompt).length + (params.userPrompt).length}`)
    logger.info(`[${MODULE}] Connecting with the model: ${this.model}`);

    let requestBody: any = {
        model: this.model,
        system: params.systemPrompt,
        prompt: params.userPrompt,
        stream: true,
    }

    if (this.model !== "ministral-3:14b") {
      requestBody = {
        ...requestBody,
        think: thinking
      };
    }

    systemStatuses.set(projectId, { object: "", message: `CONNECTING TO ${this.model} model` });
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';


    logger.info(`[${MODULE}] Streaming response...`);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const data = JSON.parse(line);
          // Yield each chunk as it arrives
          // if (!data.done){logger.debug(`DATA: ${JSON.stringify(data)}`)}
          if (!data.done && data.thinking) {  systemStatuses.set(projectId, { object: "LLM", message: 'THINKING' });}


          yield { res: data.response || null, done: data.done === true };
          // If this is the final chunk, stop the generator
          if (!data.done && data.response) {  systemStatuses.set(projectId, { object: "LLM", message: 'RESPONDING' });}

          if (data.done) return;
        } catch (err) {
          logger.error(`[${MODULE}] Failed to parse chunk: ${line}`, err);
        }
      }
    }

    // If the stream ends without a done flag, still signal completion
    yield { res: null, done: true };
  }
}
