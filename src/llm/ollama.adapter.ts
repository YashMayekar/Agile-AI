import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { ContextBuilder } from "../core/context-builder";
import { systemStatus } from "../api/project.controller";

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

export class OllamaAdapter implements LLMAdapter {
  private model: string = "gpt-oss:20b";

  async genComplete(params: { systemPrompt: string; userPrompt: string }){
    logger.info(`[${MODULE}] Generating non-streaming response.`)
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: params.systemPrompt,
        prompt: `Understand the context and repond to the User's Input:\n${params.userPrompt}\nonly in this format\n${ContextBuilder.response_structure}`,
        stream: false,
        "think": "low",
      }),
    });
    if (!response.ok) {
      logger.error(`[${MODULE}] Request failed: ${response.status}`)
      throw new Error(`Request failed: ${response.status}`);
    } 

    logger.info(`[${MODULE}] RESPONSE GENERATED`)
    const data = await response.json();
    return data;
  }
  
  
  async *generate(params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<{ res: string | null; done: boolean }> {
    logger.info(`[${MODULE}] TOTAL SIZE of INPUT:${(params.systemPrompt).length + (params.userPrompt).length}`)
    logger.info(`[${MODULE}] Connecting with the model: ${this.model}`);
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: params.systemPrompt,
        prompt: `Understand the context and repond to the User's Input:\n${params.userPrompt}\nonly in this format\n${ContextBuilder.response_structure}`,
        stream: true,
        "think": "low",
      }),
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
          // if (!data.done){logger.debug(`${JSON.stringify(data)}`)}
          yield { res: data.response || null, done: data.done === true };
          // If this is the final chunk, stop the generator
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