import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";

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
        "think": "low",
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
          if (!data.done){logger.debug(`${JSON.stringify(data)}`)}
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