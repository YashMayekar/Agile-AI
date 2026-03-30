import { OllamaAdapter } from "../llm/ollama.adapter";
import { logger } from "../utils/logger";
import { Action, BaseActionEngine } from "./action-engine/base-engine";
import { ContextBuilder } from "./context-builder";
import { ExecutionLock } from "./execution-lock";
import { MemoryManager } from "./memory-manager";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";
import { systemStatuses } from "../api/project.controller";
import { StateManager } from "./state-manager";
import fs from "fs";
import { GeminiAdapter } from "../llm/gemini.adapter";

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

  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter | GeminiAdapter,
  ): AsyncGenerator<{ res: string | null; done: boolean }, any, unknown> {

    ExecutionLock.acquire(projectId);
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`)
    systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });

    let fullResponse: string = "";
    let currentWorkflow: WorkflowStep | null = null;
    let agent: string = "orchestrator";
    
    
    let currentStepID = Number(StateManager.load(projectId).currentStepId) || 0;
    let workflowFile = StateManager.load(projectId).workflowFile || "greenfield.yaml";

    try {
      WorkflowEngine.loadWorkflow(workflowFile)
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
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`)
    }

    let requiredFiles = "";
    let missingFilesPrompt = "";
    try {
      if (currentWorkflow?.requires) {
        for (const file of currentWorkflow.requires) {
          const safePath = BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
          if (!fs.existsSync(safePath)) { 
            logger.warn(`[${MODULE}] Required file not found: ${file}\nExpected at path: ${safePath}`);  
            requiredFiles += `- ${file}\n`;
          }
        }
      missingFilesPrompt = requiredFiles ? `In the SYSTEM, The following required files are missing:\n${requiredFiles}\nACKNOWLEDGE the current input but ask user the INFORMATION NEEDED TO CREATE THEM.` : "";
      }
      
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`)
    }

    try {
      // Use provided LLM or create a new one
      const llmInstance = llm ?? new OllamaAdapter();
      // const llmInstance = llm ?? new GeminiAdapter();

      try {
        this.context = ContextBuilder.buildFullContext(projectId, currentStepID, agent);
      } catch (e) {
        logger.error(`[${MODULE}] Failed to build context: ${e}`)
      }


      this.FullPrompt = `
HERE is the CLIENT SIDE FILE STRUCTURE, if you need to perform actions on client side:
\`\`\`
${await ContextBuilder.getClientFS(projectId)}
\`\`\`
Here the paths with no extension '.' are just empty folders

${missingFilesPrompt}

only in this format\n${ContextBuilder.response_structure}

Here is the latest few conversation:
${MemoryManager.getLastNConversations(projectId, 3)}

Understand the,
*PROJECT CONTEXT*
*CONVERSATION HISTORY*
repond to the User's Input in the CORRECT FORMAT:
***${userInput}***
`


      console.log(`FULL CONTEXT:\n${this.context.slice(0, 100)}\n\nFULL PROMPT:\n${this.FullPrompt.slice(-100)}`)
      systemStatuses.set(projectId, { object: "LLM", message: "THINKING" });
      const stream = llmInstance.generate(
        projectId,
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
      await Promise.resolve(MemoryManager.addConversation(projectId, userInput, fullResponse, agent));

      console.log(`FULL RESPONSE:\n${fullResponse}`)
      let actions: Action[] | null
      actions = BaseActionEngine.getActions(fullResponse)
      await BaseActionEngine.executeActions(projectId, actions)

      systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });


      logger.info(`[${MODULE}] PROCESSING COMPLETED`);
    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      yield { res: `Error: ${error.message}`, done: true };
    } finally {
      ExecutionLock.release(projectId);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`)
    }
  }

}