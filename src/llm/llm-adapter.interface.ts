/**
 * LLM Adapter Interface
 *
 * All LLM providers MUST implement this interface.
 * This ensures the rest of the system remains provider-agnostic.
 */

export interface LLMRequest {
  systemPrompt: string;   // Role definition
  userPrompt: string;     // User input + context
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  raw: string;            // Raw text from LLM
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface LLMAdapter {
  generate(params: { systemPrompt: string; userPrompt: string }): AsyncGenerator<{ res: string | null; done: boolean }>;
}