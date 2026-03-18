import path from "path";
import { StateManager } from "./state-manager";
import { WorkflowEngine, WorkflowStep } from "./workflow-engine";
import { ContextBuilder } from "./context-builder";
import { MemorySummarizer } from "./memory-summarizer";
import { FileSystem } from "../utils/file-system";
import { logEvent, logger } from "../utils/logger";
import { AnalystAgent } from "../agents/analyst.agent";
import { PMAgent } from "../agents/pm.agent";
// import other agents (add stubs if needed)
import { ExecutionLock } from "./execution-lock";
import { repairJSON } from "../utils/json-repair";
import { OllamaAdapter } from "../llm/ollama.adapter";
import { ProjectState } from "./project-state/project-state.model";
import { OrchestratorAgent } from "../agents/orchestrator.agent";
import { log } from "console";

const MODULE = "orchestrator.ts";

export class Orchestrator {
  /**
   * Handle user input (non‑streaming). Returns the parsed action and message.
   */
  static async handleUserInput(projectId: string, userInput: string): Promise<any> {
    ExecutionLock.acquire(projectId);
    let fullRaw = '';

    try {
      logger.info(`[${MODULE}] Processing input for project: ${projectId}`);
      let state = StateManager.load(projectId);

      // ----- MIGRATION / DEFENSIVE INIT -----
      if (!state.contextMemory) {
        state.contextMemory = { summary: "", decisions: [], architectureNotes: [] };
      }
      if (!state.dynamicContext) {
        state.dynamicContext = { stories: [], currentStoryIndex: 0, qaLeftUnchecked: false };
      }
      if (state.currentStepId === null || state.currentStepId === undefined) {
        const workflow = WorkflowEngine.loadWorkflow(state.workflowFile);
        state.currentStepId = WorkflowEngine.findInitialStep(workflow, state);
        if (!state.currentStepId) {
          throw new Error("No executable step found – workflow may be complete.");
        }
      }

      const workflow = WorkflowEngine.loadWorkflow(state.workflowFile);
      const currentStepId = state.currentStepId;
      let baseStepId: number | null = null;
      if (typeof currentStepId === 'string') {
        baseStepId = parseInt(currentStepId.split('-')[0], 10);
      } else if (typeof currentStepId === 'number') {
        baseStepId = currentStepId;
      } else {
        throw new Error(`[${MODULE}] Invalid currentStepId type: ${typeof currentStepId}`);
      }

      const step = WorkflowEngine.getStepById(workflow, baseStepId!);
      if (step.condition && !WorkflowEngine.evaluateCondition(step.condition, state)) {
        throw new Error(`Step ${currentStepId} condition not met.`);
      }

      const context = ContextBuilder.build(state, step, userInput);
      const llm = new OllamaAdapter();
      const agent = this.createAgent(step.agent, llm);

      // Generate full response (non‑streaming)
      const response = await agent.executeStream(context);
      logger.debug(`[${MODULE}] Received response stream from agent ${step.agent}`);
      logger.debug(`[${MODULE}] Starting to read response stream...`);
      logger.debug(`[${MODULE}] ${response}`);
      for await (const chunk of response) {
        fullRaw += chunk;
      }
      

      logger.debug(`[${MODULE}] Full raw response received:\n${fullRaw}`);

      // Split into JSON and content
      const { actionJson, content } = this.splitResponse(fullRaw);
      const parsedAction = await this.parseJSON(actionJson, projectId);

      // Apply file actions based on the parsed action
      await this.applyFileActions(projectId, state, parsedAction, content);

      // If the action created/updated a file, update document registry
      if (parsedAction.action === "WRITE" || parsedAction.action === "UPDATE") {
        if (parsedAction.path) {
          state = StateManager.updateDocument(state, parsedAction.path);
        }
      }

      // Add history entry using the message from the action
      state = StateManager.addHistory(state, currentStepId, step.agent, parsedAction.message || "No summary provided");

      // Apply after-step logic
      state = StateManager.applyAfterStep(state, step, parsedAction);

      // Determine next step
      const nextStepId = WorkflowEngine.getNextStepId(step, state);
      if (nextStepId) {
        state.currentStepId = nextStepId;
      } else {
        state.currentStepId = null;
        logEvent("WORKFLOW_COMPLETE", { projectId });
      }

      if (this.isOneTimeStep(step.id)) {
        state = StateManager.markStepCompleted(state, step.id);
      }

      state = await MemorySummarizer.summarize(state, llm);
      StateManager.save(projectId, state);

      logEvent("ORCHESTRATION_COMPLETE", { projectId, nextStepId });

      // Return a clean result to the controller
      return {
        message: parsedAction.message,
        action: parsedAction,
        nextStep: nextStepId,
        content: content
      };

    } catch (error: any) {
      logger.error(`[${MODULE}] Processing failed: ${error.message}`);
      throw error;
    } finally {
      ExecutionLock.release(projectId);
    }
  }

  /**
   * Split raw LLM output into JSON part and optional content part.
   * Returns { actionJson: string, content: string | null }
   */
  private static splitResponse(raw: string): { actionJson: string; content: string | null } {
    const contentStart = raw.indexOf('<<<content>>>');
    if (contentStart === -1) {
      // No content block – the whole thing should be JSON
      return { actionJson: raw.trim(), content: null };
    }

    const actionJson = raw.substring(0, contentStart).trim();
    const contentEnd = raw.indexOf('<<<end-content>>>', contentStart);
    if (contentEnd === -1) {
      throw new Error("Malformed response: found <<<content>>> but no <<<end-content>>>");
    }
    const content = raw.substring(contentStart + '<<<content>>>'.length, contentEnd).trim();
    return { actionJson, content };
  }

  /**
   * Parse JSON after cleaning and optional repair.
   */
  private static async parseJSON(rawJson: string, projectId: string): Promise<any> {
    const cleaned = this.cleanRawString(rawJson);
    logger.debug(`[${MODULE}] Cleaned JSON: ${cleaned.substring(0, 200)}...`);

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      logger.warn(`[${MODULE}] JSON parse failed, attempting repair`);
      logEvent("LLM_JSON_PARSE_FAILED", { projectId });
      const repaired = await repairJSON(cleaned);
      try {
        const parsed = JSON.parse(repaired);
        logger.info(`[${MODULE}] JSON repaired successfully`);
        logEvent("LLM_JSON_REPAIRED_SUCCESS", { projectId });
        return parsed;
      } catch {
        logger.error(`[${MODULE}] JSON repair failed`);
        logEvent("LLM_JSON_REPAIR_FAILED", { projectId });
        throw new Error("LLM output could not be repaired to valid JSON.");
      }
    }
  }

  private static cleanRawString(raw: string): string {
    let cleaned = raw.trim();

    // Remove any text before the first '{' or '[' and after the last '}' or ']'
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    let start = 0;
    if (firstBrace === -1 && firstBracket === -1) {
      start = 0;
    } else if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;
    } else {
      start = firstBracket;
    }

    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    let end = cleaned.length;
    if (lastBrace !== -1 && (lastBracket === -1 || lastBrace > lastBracket)) {
      end = lastBrace + 1;
    } else if (lastBracket !== -1) {
      end = lastBracket + 1;
    }

    cleaned = cleaned.substring(start, end);

    // Replace literal \n and \" sequences
    cleaned = cleaned.replace(/\\n/g, ' ').replace(/\\"/g, '"');
    return cleaned;
  }

  private static createAgent(agentType: string, llm: OllamaAdapter) {
    logger.debug(`[${MODULE}] Creating agent of type: ${agentType}`);
    switch (agentType) {
      case "orchestrator": return new OrchestratorAgent(llm);
      case "analyst": return new AnalystAgent(llm);
      case "pm": return new PMAgent(llm);
      case "po": return new PMAgent(llm);
      case "dev": return new PMAgent(llm);
      case "qa": return new PMAgent(llm);
      case "architect": return new PMAgent(llm);
      case "sm": return new PMAgent(llm);
      case "ux-expert": return new PMAgent(llm);
      default:
        logger.error(`[${MODULE}] Unknown agent type: ${agentType}`);
        throw new Error(`Unknown agent: ${agentType}`);
    }
  }

  private static async applyFileActions(projectId: string, state: ProjectState, action: any, content: string | null) {
    // Only handle WRITE, UPDATE, DELETE
    if (action.action === "WRITE" || action.action === "UPDATE") {
      if (!action.path) {
        logger.error(`[${MODULE}] File action missing path: ${JSON.stringify(action)}`);
        throw new Error("File path missing in LLM action.");
      }
      if (content === null) {
        throw new Error(`Action ${action.action} requires content but none provided.`);
      }
      const resolvedPath = WorkflowEngine.resolvePlaceholders(action.path, state);
      const safePath = path.join("projects", projectId, resolvedPath);
      FileSystem.ensureDir(path.dirname(safePath));
      FileSystem.writeFile(safePath, content);
      logger.debug(`[${MODULE}] File written: ${safePath}`);
    } else if (action.action === "DELETE") {
      if (!action.path) {
        logger.error(`[${MODULE}] DELETE action missing path`);
        throw new Error("File path missing for DELETE.");
      }
      const resolvedPath = WorkflowEngine.resolvePlaceholders(action.path, state);
      const safePath = path.join("projects", projectId, resolvedPath);
      // if (FileSystem.exists(safePath)) {
      //   FileSystem.deleteFile(safePath);
      //   logger.debug(`[${MODULE}] File deleted: ${safePath}`);
      // } else {
      //   logger.warn(`[${MODULE}] File to delete not found: ${safePath}`);
      // }
    }
    // Other actions (RESPONSE, SWITCH-AGENT) are handled elsewhere
  }

  private static isOneTimeStep(stepId: number): boolean {
    const result = (stepId >= 1 && stepId <= 7) || stepId >= 16;
    logger.debug(`[${MODULE}] Step ${stepId} is one-time: ${result}`);
    return result;
  }
}