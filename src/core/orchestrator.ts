/**
 * Orchestrator
 *
 * Central brain of the system.
 * Controls:
 * - Execution locking
 * - State loading
 * - Workflow progression
 * - Agent selection
 * - LLM execution
 * - JSON validation & repair
 * - File operations
 * - State updates
 * - Logging
 */

import path from "path";

import { StateManager } from "./state-manager";
import { WorkflowEngine } from "./workflow-engine";
import { ContextBuilder } from "./context-builder";
import { SchemaValidator } from "./schema-validator";
import { MemorySummarizer } from "./memory-summarizer";
import { FileSystem } from "../utils/file-system";
import { logEvent, logger } from "../utils/logger";

import { AnalystAgent } from "../agents/analyst.agent";
import { PMAgent } from "../agents/pm.agent";

import { ExecutionLock } from "./execution-lock";
import { repairJSON } from "../utils/json-repair";
import { OllamaAdapter } from "../llm/ollama.adapter";
import { log } from "console";

export class Orchestrator {

  static async handleUserInput(projectId: string, userInput: string) {

    // 🔐 Acquire execution lock at the very beginning
    ExecutionLock.acquire(projectId);

    try {
      logger.info(`Orchestration started for project: ${projectId}`);
      // logEvent("ORCHESTRATION_STARTED", { projectId });
      
      // 1️⃣ Load state
      let state = StateManager.load(projectId);
      
      logger.debug(`currentStep: ${JSON.stringify(state.currentStepId)} `);
      // 2️⃣ Load workflow
      const workflow = WorkflowEngine.loadWorkflow(state.workflowFile);
      // 3️⃣ Get current step
      const currentStep = WorkflowEngine.getCurrentStep(workflow, state.currentStepId);
      
      // 4️⃣ Validate step requirements
      // WorkflowEngine.validateRequirements(
      //   currentStep.requires,
      //   state.documents
      // );

      // 5️⃣ Build agent context
      const context = ContextBuilder.build(state, currentStep, userInput);
      logger.debug(`Context built for project: ${projectId}, context: ${JSON.stringify(context)}`);

      // 6️⃣ Select LLM (Ollama local)
      const llm = new OllamaAdapter();

      // 7️⃣ Select agent
      let agent;
      
      logger.debug(`Selected: ${currentStep.agent}, agent for project: ${projectId}`);

      switch (currentStep.agent) {
        case "analyst":
          agent = new AnalystAgent(llm);
          break;
        case "pm":
          agent = new PMAgent(llm);
          break;
        case "po":
          agent = new PMAgent(llm);
          break;
        case "dev":
          agent = new PMAgent(llm);
          break;  
        case "qa":
          agent = new PMAgent(llm);
          break;  
        case "architect":
          agent = new PMAgent(llm);
          break;  
        case "sm":
          agent = new PMAgent(llm);
          break;
        case "ux-expert":
          agent = new PMAgent(llm);
          break;
        default:
          throw new Error(`Unknown agent: ${currentStep.agent}`);
      }

      // 8️⃣ Execute agent
      const llmResponse = await agent.execute(context);
      
      logger.info(`LLM response received : 
        ${JSON.stringify(llmResponse)}`);

      // 9️⃣ Parse JSON with automatic repair retry
      let parsed;

      try {
        parsed = JSON.parse(llmResponse.raw);
        
        logger.debug(`Parsed JSON: ${JSON.stringify(parsed)}`);
      } catch (e: any) {

        logEvent("LLM_JSON_PARSE_FAILED", { projectId });

        const repairedOutput = await repairJSON(llmResponse.raw);

        try {
          parsed = JSON.parse(repairedOutput);

          logEvent("LLM_JSON_REPAIRED_SUCCESS", { projectId });

        } catch {
          logEvent("LLM_JSON_REPAIR_FAILED", { projectId });
          throw new Error("LLM output could not be repaired to valid JSON.");
        }
      }


      
      // 🔟 Validate response schema
      // SchemaValidator.validate("llm-response.schema.json", parsed);

      // 1️⃣1️⃣ Apply file actions safely
      // for (const action of parsed.actions) {

      //   if (action.type === "create_file" || action.type === "update_file") {

      //     if (!action.path) {
      //       throw new Error("File path missing in LLM action.");
      //     }

      //     const safePath = path.join("projects", projectId, action.path);

      //     // Ensure directory exists
      //     FileSystem.ensureDir(path.dirname(safePath));

      //     FileSystem.writeFile(safePath, action.content || "");

      //     state = StateManager.updateDocument(state, action.path);
      //   }

      //   if (action.type === "delete_file") {

      //     // Add safe delete logic later (intentionally restricted)
      //     logEvent("DELETE_ACTION_REQUESTED", {
      //       projectId,
      //       path: action.path
      //     });
      //   }
      // }

      // 1️⃣2️⃣ Add history entry
      state = StateManager.addHistory(
        state,
        state.currentStepId,
        currentStep.agent,
        parsed.message
      );

      // 1️⃣3️⃣ Move to next workflow step
      const nextStepId = WorkflowEngine.getNextStep(currentStep);
      state = StateManager.completeStep(state, nextStepId);

      // 1️⃣4️⃣ Update memory summary
      state = MemorySummarizer.summarize(state);

      // 1️⃣5️⃣ Persist state
      StateManager.save(projectId, state);

      logEvent("ORCHESTRATION_COMPLETE", {
        projectId,
        nextStepId
      });

      return {
        message: parsed.message,
        actions: parsed.actions
      };

    } catch (error: any) {

      logEvent("ORCHESTRATION_FAILED", {
        projectId,
        error: error.message
      });

      throw error;

    } finally {

      // 🔓 Always release lock
      ExecutionLock.release(projectId);
    }
  }
}
