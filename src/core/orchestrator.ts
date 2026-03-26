import { OllamaAdapter } from "../llm/ollama.adapter";
import { logger } from "../utils/logger";
import { Action, BaseActionEngine } from "./action-engine/base-engine";
import { ContextBuilder } from "./context-builder";
import { ExecutionLock } from "./execution-lock";
import { MemoryManager } from "./memory-manager";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";

const MODULE = "orchestrator.ts";

export class Orchestrator {
  /**
   * Handle user input using conversation memory.
   * Yields tokens as they arrive and updates history.txt.
   * @param projectId - The project identifier
   * @param userInput - The user's message
   * @param llm - Optional pre‑initialized LLM instance (to avoid recreation)
   */
  public static FullPrompt: string = "";
  public static context: string = "";
  private static agent: string = "";

  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter,
  ): AsyncGenerator<{ res: string | null; done: boolean }, any, unknown> {

    ExecutionLock.acquire(projectId);
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`)

    let fullResponse: string = "";
    let currentWorkflow: WorkflowStep | null = null;
    let agent: string = "";
    let currentStepID = 0;


    try {
      WorkflowEngine.loadWorkflow("greenfield.yaml")
      currentWorkflow = WorkflowEngine.getStepById(currentStepID)
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading worlflow step: ${e}`)
    }

    try {
      if (!currentWorkflow) {
        throw new Error("Workflow step not found");
        // Error handling needs to be implemented...
      }
      agent = currentWorkflow.agent;
      this.agent = agent
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`)
    }

    try {
      // Use provided LLM or create a new one
      const llmInstance = llm ?? new OllamaAdapter();

      try {
        this.context = ContextBuilder.buildFullContext(projectId, currentStepID, agent);
      } catch (e) {
        logger.error(`[${MODULE}] Failed to build context: ${e}`)
      }


      this.FullPrompt = `
      This is the file structure of the user's code base:
      \`\`\`
      ${await ContextBuilder.getClientFS(projectId)}
      \`\`\`
      Here the paths with no extension '.' are just empty folders

      Understand the context and repond to the User's Input:
      ${userInput}

      only in this format\n${ContextBuilder.response_structure}`

        

      // Stream the response
      const stream = llmInstance.generate(
        {
          systemPrompt: this.context,
          userPrompt: this.FullPrompt,
        }
      );

      for await (const chunk of stream) {
        yield chunk;
        if (chunk.res) {
          fullResponse += chunk.res;
        }
      }
      // logger.debug(`[${MODULE}] full response from ${agent} LLM: ${fullResponse}`)
      MemoryManager.addConversation(projectId, userInput, fullResponse, agent);

      let actions: Action[] | null
      actions = BaseActionEngine.getActions(fullResponse)
      BaseActionEngine.executeActions(projectId, actions)


      logger.info(`[${MODULE}] PROCESSING COMPLETED`);
    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      yield { res: `Error: ${error.message}`, done: true };
    } finally {
      ExecutionLock.release(projectId);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`)
    }
  }

  static async handleSystemInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter,
  ): Promise<any> {
    ExecutionLock.acquire(`${projectId}-BY-SYS`);
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input for system inputs`)

    try {
      // Use provided LLM or create a new one
      const llmInstance = llm ?? new OllamaAdapter();

      logger.debug(`[${MODULE}] Using existing Content and Full Prompt`)
      // ✅ Await the response
      console.log(`THE EXISTING CONTEXT:\n${this.context}`)
      const fullResponse = await llmInstance.genComplete(
        {
          systemPrompt: this.context,
          userPrompt: userInput
        }
      );

      // ✅ Extract actual text (important for Ollama)
      const responseText = typeof fullResponse === "string"
        ? fullResponse
        : fullResponse.response;

      MemoryManager.addConversation(projectId, userInput, responseText, this.agent);

      // ✅ Parse actions
      const actions: Action[] | null = BaseActionEngine.getActions(responseText);

      // ✅ Execute actions
      // BaseActionEngine.executeActions(projectId, actions);

      // ✅ Store memory

      logger.info(`[${MODULE}] Completed processing for system inputs`);

      // ✅ Return final response
      return {
        res: responseText,
        actions
      };

    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);

      return {
        res: `Error: ${error.message}`,
        actions: []
      };

    } finally {
      ExecutionLock.release(`${projectId}-BY-SYS`);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`)

    }
  }
}