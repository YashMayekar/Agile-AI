/**
 * Anthropic Adapter (Stub)
 * Implements LLMAdapter.
 * Extend this with real API logic later.
 */

import { LLMAdapter, LLMRequest, LLMResponse } from "./llm-adapter.interface";

export class AnthropicAdapter implements LLMAdapter {

  async generate(request: LLMRequest): Promise<LLMResponse> {
    throw new Error("Anthropic adapter not implemented yet.");
  }
}
