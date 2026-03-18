import { LLMAdapter } from "../llm/llm-adapter.interface";
import { logger } from "../utils/logger";

export abstract class BaseAgent {
  protected llm: LLMAdapter;

  constructor(llm: LLMAdapter) {
    this.llm = llm;
  }

  abstract getSystemPrompt(): string;
  abstract buildUserPrompt(context: any): string;

  async execute(context: any) {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildUserPrompt(context);
    return this.llm.generate({ systemPrompt, userPrompt });
  }

  async *executeStream(context: any): AsyncGenerator<string> {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.buildUserPrompt(context);
    // logger.debug(`[BaseAgent] Executing stream with system prompt length ${systemPrompt.length} and user prompt length ${userPrompt.length}`);
    for await (const chunk of this.llm.generateStream({ systemPrompt, userPrompt })) {
      // logger.debug(`[BaseAgent] Received chunk: ${chunk.substring(0, 100)}...`);
      yield chunk;
    }
  }
}