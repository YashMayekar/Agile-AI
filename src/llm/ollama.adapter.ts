/**
 * Ollama Adapter
 * Connects to local Ollama server.
 * Assumes model already pulled (e.g., llama3, mistral, etc.)
 */

import axios from "axios";
import { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter.interface";
import { logEvent } from "../utils/logger";

export class OllamaAdapter implements LLMAdapter {

  private model: string;

  constructor(model: string = "llama3.1:8b") {
    this.model = model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {

    const start = Date.now();

    const prompt = `
SYSTEM:
${request.systemPrompt}

USER:
${request.userPrompt}
`;

    try {

      const response = await axios.post(
        "http://localhost:11434/api/generate",
        {
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: request.temperature ?? 0.2
          }
        }
      );

      const duration = Date.now() - start;

      logEvent("OLLAMA_CALL_SUCCESS", {
        model: this.model,
        durationMs: duration
      });

      return {
        raw: response.data.response,
        model: this.model
      };

    } catch (error: any) {

      logEvent("OLLAMA_CALL_FAILED", {
        error: error.message
      });

      throw error;
    }
  }
}
