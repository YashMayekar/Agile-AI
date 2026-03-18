import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { log } from "console";


export class OllamaAdapter implements LLMAdapter {
  private model: string = "llama3.1:8b"; // or configurable
  
  async generate(params: { systemPrompt: string; userPrompt: string }): Promise<{ raw: string; message: string }> {
    logger.debug(`[ollama.adapter.ts] Sending request to Ollama with model ${this.model}`);
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: params.systemPrompt,
        prompt: params.userPrompt,
        stream: false,
      }),
    });
    const data = await response.json();
    logger.debug(`[ollama.adapter.ts] Received response from Ollama: ${data.response.substring(0, 100)}...`);
    return { raw: data.response, message: data.response };
  }

  async *generateStream(params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<string> {
    logger.debug(`[ollama.adapter.ts] Starting streaming generation with model ${this.model}`);
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        system: params.systemPrompt,
        prompt: params.userPrompt,
        stream: true,
      }),
    });
    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    logger.debug(`[ollama.adapter.ts] Connected to Ollama streaming endpoint`);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      try{
        const data = JSON.parse(buffer);
        if (data.response) {
          logger.debug(`${data.response}\n`);          
          yield data.response;
          buffer = '';
        }
      }
      catch(e){
        // Incomplete JSON, wait for more data
      }      
    } 
  }
}