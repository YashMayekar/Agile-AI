import { OllamaAdapter } from "../llm/ollama.adapter";
import { logger } from "../utils/logger";
import { ExecutionLock } from "./execution-lock";
import { MemoryManager } from "./memory-manager";

const MODULE = "orchestrator.ts";

export class Orchestrator {
  /**
   * Handle user input using conversation memory.
   * Yields tokens as they arrive and updates history.txt.
   * @param projectId - The project identifier
   * @param userInput - The user's message
   * @param llm - Optional pre‑initialized LLM instance (to avoid recreation)
   */
  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter
  ): AsyncGenerator<{ res: string | null; done: boolean }, any, unknown> {
    ExecutionLock.acquire(projectId);
    let fullResponse = "";

    try {
      logger.info(`[${MODULE}] Processing input for project: ${projectId}`);

      // Load conversation history
      const history = MemoryManager.loadHistory(projectId);
      logger.debug(`[${MODULE}] Loaded ${history.length} messages from history`);

      // Build system prompt with conversation history
      let systemPrompt = "You are a helpful assistant that remembers the conversation.\n\n";
      if (history.length > 0) {
        systemPrompt += "Here is the conversation so far:\n";
        systemPrompt += history
          .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
          .join("\n");
        systemPrompt += "\n\n";
      }
      systemPrompt += "Now respond to the user's latest message.";

      // Use provided LLM or create a new one
      const llmInstance = llm ?? new OllamaAdapter();

      // Stream the response
      const stream = llmInstance.generate({
        systemPrompt,
        userPrompt: userInput,
      });

      for await (const chunk of stream) {
        yield chunk;
        if (chunk.res) {
          fullResponse += chunk.res;
        }
      }

      // Save both messages to history
      MemoryManager.addMessage(projectId, "user", userInput);
      MemoryManager.addMessage(projectId, "assistant", fullResponse.trim());

      logger.info(`[${MODULE}] Completed processing for project ${projectId}`);
    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      yield { res: `Error: ${error.message}`, done: true };
    } finally {
      ExecutionLock.release(projectId);
    }
  }
}