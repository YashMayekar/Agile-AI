import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";

export class OllamaAdapter implements LLMAdapter {
  private model: string = "gpt-oss:20b";

  async *generate(params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<{ res: string | null; done: boolean }> {
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
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    logger.debug(`[ollama.adapter.ts] Streaming response`);

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
          yield { res: data.response || null, done: data.done === true };
          // If this is the final chunk, stop the generator
          if (data.done) return;
        } catch (err) {
          logger.warn(`[ollama.adapter.ts] Failed to parse chunk: ${line}`, err);
        }
      }
    }

    // If the stream ends without a done flag, still signal completion
    yield { res: null, done: true };
  }
}