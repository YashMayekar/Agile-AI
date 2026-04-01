// This implementation assumes that the Ollama API at / api / chat can handle both streaming and non - streaming requests, and that it returns data in the expected format.The generate method reads the response stream, decodes it, and yields chunks of data as they arrive, while also updating the system status based on whether the model is thinking or responding.

import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { systemStatuses } from "../api/project.controller";
import * as fs from "fs";

const MODULE = "ollama.adapter.ts"

// Keep the same JSON schema for structured responses
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
  // nemotron-3-nano:4b
  // gpt-oss:20b 
  // devstral-small-2:24b     
  // deepseek-coder-v2:16b    
  // qwen3.5:9b
  // deepcoder:14b            
  // ministral-3:14b          
  // qwen3.5:27b              
  // glm-5:cloud              
  // devstral-2:123b-cloud    

  async GetWorkFlowType(projectId: string, input: string): Promise<any> {
    let thinking: string | boolean = true;
    if (this.model === "gpt-oss:20b") {
      thinking = "high";
    }

    logger.info(`[${MODULE}] Fetching the project workflow type.`)



    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'user', content: `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"` }
        ],
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
    return data.message.content;
  }

  async executeAction(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: { role: string, content: string }[] }): Promise<any> {
    let thinking: string | boolean = true;
    if (this.model === "gpt-oss:20b") {
      thinking = "medium";
    }

    logger.info(`[${MODULE}] TOTAL SIZE of INPUT:${(params.systemPrompt).length + (params.userPrompt).length}`)
    logger.info(`[${MODULE}] Generating non-streaming response.`)

    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          ...(params.history || []),
          { role: 'user', content: `${params.dynamicContext ? `[SYSTEM AUTOMATED CONTEXT INJECTION - THIS IS BACKGROUND INFO, DO NOT REPLY TO IT DIRECTLY]\n${params.dynamicContext}\n[END CONTEXT]\n\n` : ''}${params.userPrompt}` }
        ],
        stream: false,
        think: thinking,
        format: responseSchema,
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

  async *generate(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: { role: string, content: string }[] }): AsyncGenerator<{ res: string | null; tools: string | null; done: boolean }> {

    const useChat = false; // Assuming we want to use the chat endpoint for better context handling

    const endpoint = useChat
      ? 'http://localhost:11434/api/chat'
      : 'http://localhost:11434/api/generate';

    let thinking: string | boolean = false;
    if (this.model === "gpt-oss:20b") {
      thinking = "medium";
    }

    logger.info(`[${MODULE}] Connecting with the model: ${this.model}`);

    let requestBody: any = {
      model: this.model,
      stream: true,
      keep_alive: "1m"
    };

    let totalInput = "";

    if (useChat) {
      requestBody.messages = [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt }
      ];
      totalInput = requestBody.messages.map((m: any) => `${m.role}: ${m.content}`).join('\n');
      requestBody.format = responseSchema;
    } else {
      requestBody.system = params.systemPrompt;
      requestBody.prompt = params.userPrompt;
      totalInput = requestBody.system + requestBody.prompt;
    }

    // Special case for models that don't support 'think'
    if (this.model !== "ministral-3:14b") {
      requestBody.think = thinking;
    }


    systemStatuses.set(projectId, { object: "", message: `CONNECTING TO ${this.model} model` });

    logger.info(`[${MODULE}] TOTAL SIZE of INPUT:${totalInput.length}`)
    fs.writeFileSync(`logs/full-input.md`, totalInput);

    console.time('Response Time');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    logger.info(`[${MODULE}] Streaming response...`);

    console.timeEnd('Response Time');
    console.time('thinking Time');
    let thinkingLogged: boolean = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep last incomplete line

      for (const line of lines) {
        if (line.trim() === '') continue;
        try {
          const data = JSON.parse(line);

          // generate streaming chunks 
          // const content = data.response || null;
          // const isDone = data.done === true;

          let content = null;
          let tool = null;
          // Chat streaming chunks contain 'message.content'
          if (useChat) {
            content = data.message?.content || null;
            tool = data.message?.tool_calls || null;
          } else {
            content = data.response || null;
          }

          const isDone = data.done === true;
          // Update status based on streaming content and thinking flag
          if (!isDone) {
            if (data.message?.thinking || data.thinking) {
              systemStatuses.set(projectId, { object: "LLM", message: 'THINKING' });
            } else if (content) {
              if (!thinkingLogged) {
                console.timeEnd('thinking Time');
                thinkingLogged = true;
              }
              systemStatuses.set(projectId, { object: "LLM", message: 'RESPONDING' });
            }
          }


          yield { res: content, tools: tool, done: isDone };

          if (isDone) return;
        } catch (err) {
          logger.error(`[${MODULE}] Failed to parse chunk: ${line}`, err);
        }
      }
    }

    // If stream ends without a done flag, signal completion
    yield { res: null, tools: null, done: true };
  }
}