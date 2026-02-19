/**
 * OpenAI Adapter
 * Implements LLMAdapter interface.
 * Converts generic request to OpenAI Chat API format.
 */

import axios from "axios";
import { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter.interface";
import { logEvent } from "../utils/logger";

export class OpenAIAdapter implements LLMAdapter {

  private apiKey: string;
  private model: string;

  constructor(model: string = "gpt-4o-mini") {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set in environment");
    }

    this.apiKey = process.env.OPENAI_API_KEY;
    this.model = model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {

    const startTime = Date.now();

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: this.model,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 2000,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt }
          ]
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          }
        }
      );

      const raw = response.data.choices[0].message.content;

      const duration = Date.now() - startTime;

      logEvent("LLM_CALL_SUCCESS", {
        provider: "openai",
        model: this.model,
        durationMs: duration,
        usage: response.data.usage
      });

      return {
        raw,
        inputTokens: response.data.usage?.prompt_tokens,
        outputTokens: response.data.usage?.completion_tokens,
        model: this.model
      };

    } catch (error: any) {

      logEvent("LLM_CALL_FAILED", {
        provider: "openai",
        error: error.message
      });

      throw error;
    }
  }
}
