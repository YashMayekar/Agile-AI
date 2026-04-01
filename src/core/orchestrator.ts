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
import { IntentAnalyzer } from "./intent-analyzer";

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
    isAutoTrigger: boolean = false,
    depth: number = 0
  ): AsyncGenerator<{ res: string | null; tools?: any; done: boolean }, any, unknown> {

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
        missingFilesPrompt = requiredFiles ? `MISSING REQUIRED FILES: The following files needed to be created FIRST in this step:\n${requiredFiles}` : "ALL REQUIRED FILES ARE PRESENT.";
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

      const CLITree = await ContextBuilder.getClientFS(projectId)

      let clientData = ""
      if (CLITree) {
        clientData = `
# HERE is the CLIENT SIDE FILE STRUCTURE, if you need to perform actions on client side:
\`\`\`
${CLITree}
\`\`\`
# Here the paths with no extension '.' are just empty folders
IF You want to acces or write in the client side, proide target path as CLI:<folder>/<filename>.extension
`

      }

      let systemData = ``

      // This part fetches the files generated in the projectid/docs
      try {
        const docsPath = BaseActionEngine.resolveSafePath(projectId, "docs");
        if (fs.existsSync(docsPath)) {
          const files = fs.readdirSync(docsPath);
          if (files.length > 0) {
            systemData = `
# Here are the files generated in the system at the path ${projectId}/docs:
\`\`\`
${files.join("\n")}
\`\`\`
Before generating or reading files in the system check if its present in the above list.
`}
        }
      } catch (e) {
        logger.error(`[${MODULE}] Error in loading system data: ${e}`)
      }

      // NEW INTENT PRE-PROCESSING -------------
      // let preActions: Action[] = [];
      // let contextInjection = "";

      // if (!isAutoTrigger) {
      //   systemStatuses.set(projectId, { object: "INTENT", message: "ANALYZING..." });
      //   preActions = await IntentAnalyzer.analyze(userInput, CLITree || "");
      // }

      // if (preActions && preActions.length > 0) {
      //   systemStatuses.set(projectId, { object: "INTENT", message: "FETCHING CONTEXT" });
      //   await BaseActionEngine.executeActions(projectId, preActions);

      //   // Extract results
      //   const readResults = BaseActionEngine.getAggregatedReadContext();
      //   if (readResults) {
      //     contextInjection = `\n# PRE-FETCHED CONTEXT (Files requested during intent phase):\n${readResults}\n`;
      //   }
      // }
      // ---------------------------------------

      const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);

      this.FullPrompt = `
${clientData}

${systemData}

This is your conversation history with the user:
${JSON.stringify(structuredHistory)}

Follow this response structure:
${ContextBuilder.response_structure}

Now respond to the user's message: 
**${userInput}**`;
      // create a full-input.txt file with the current full input to the LLM.
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

      let actions: Action[] | null
      actions = BaseActionEngine.getActions(fullResponse)
      const executionResult = await BaseActionEngine.executeActions(projectId, actions)

      systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });


      logger.info(`[${MODULE}] PROCESSING COMPLETED`);

      // if (executionResult && executionResult.sysResults) {
      //   const workflowSuccess = executionResult.sysResults.find(r => r.type === 'WORKFLOW' && r.content === 'SUCCESS');
      //   if (workflowSuccess && depth < 5) {
      //     logger.info(`[${MODULE}] AUTO-TRIGGERING NEXT AGENT DUE TO WORKFLOW SUCCESS at depth ${depth}`);
      //     const triggerMsg = "[SYSTEM AUTO-TRIGGER]: Workflow advanced successfully. Your role and step may have changed. Please read the history, introduce yourself, state the goal of your new step, and begin the GATHER PHASE by asking the user the necessary questions.";
      //     for await (const chunk of Orchestrator.handleUserInput(projectId, triggerMsg, llmInstance, true, depth + 1)) {
      //       yield chunk;
      //     }
      //   }
      // }
    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      yield { res: `Error: ${error.message}`, done: true };
    } finally {
      ExecutionLock.release(projectId);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`)
    }
  }

}