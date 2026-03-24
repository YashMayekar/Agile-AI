import { OllamaAdapter } from "../llm/ollama.adapter";
import { logger } from "../utils/logger";
import { ContextBuilder } from "./context-builder";
import { ExecutionLock } from "./execution-lock";
import { MemoryManager } from "./memory-manager";
import { StateManager } from "./state-manager";
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
  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter
  ): AsyncGenerator<{ res: string | null; done: boolean }, any, unknown> {
    ExecutionLock.acquire(projectId);
      let fullResponse: string = "";
      let context: string = "";
      let steps: string = "";
      let currentWorkflow: WorkflowStep | null = null;
      let agent: string = "";    
      let currentStepID = 1;

    try {
      WorkflowEngine.loadWorkflow("greenfield.yaml")
      currentWorkflow = WorkflowEngine.getStepById(currentStepID)
       
      logger.warn(`${MODULE}\n${JSON.stringify(steps)}`)
    } catch (e) {
      logger.error(`${MODULE} Error in loading worlflow step: ${e}`)
    }

    try {
      if (!currentWorkflow) {
        throw new Error("Workflow step not found");
      }
      agent = currentWorkflow.agent;
    } catch (e) {
      logger.error(`${MODULE} Error in ${agent} prompt: ${e}`)
    }

    try {
      logger.info(`[${MODULE}] Processing input for project: ${projectId}`);

      // Load conversation history
      
      // Build system prompt with conversation history
      let chatHistory = "You are a helpful assistant that remembers the conversation.\n\nHere is the last 2 conversation :\n"
      + MemoryManager.getLastNConversations(projectId, 2) + "\n\n" 
      

      // Use provided LLM or create a new one
      const llmInstance = llm ?? new OllamaAdapter();


      try{
        
        context = ContextBuilder.buildFullContext(projectId, currentStepID, agent)

      } catch (e) {
        logger.error(`${MODULE} Faild to build context for project: ${projectId}\nError: ${e}`)
      }

      // Stream the response
      const stream = llmInstance.generate({
        systemPrompt: context,
        userPrompt: `Understand the context and repond to the User's Input:\n${userInput}\nonly in this format\n${ContextBuilder.response_structure}`,
      });

      for await (const chunk of stream) {
        yield chunk;
        if (chunk.res) {
          fullResponse += chunk.res;
        }
      }

      MemoryManager.addConversation(projectId, userInput, fullResponse, agent);

      logger.info(`[${MODULE}] Completed processing for project ${projectId}`);
    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      yield { res: `Error: ${error.message}`, done: true };
    } finally {
      ExecutionLock.release(projectId);
    }
  }
}