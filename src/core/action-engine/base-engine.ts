import fs from "fs";
import path from "path";
import { logger } from "../../utils/logger";
import { ProjectStateRepository } from "../project-state/project-state.repository";
import { ReadHandler } from "./read.action";
import { WriteHandler } from "./write.action";
import { DeleteHandler } from "./delete.action";
import { UpdateHandler } from "./update.action";
import { SwitchHandler } from "./switch.action";
import { WorkflowHandler } from "./workflow.action";

const MODULE = "base-engine.ts";

export interface Action {
  type: "READ" | "WRITE" | "DELETE" | "UPDATE" | "SWITCH-AG" | "WORKFLOW" | "NONE";
  target: string;
  content: string;
}

export interface ActionResponse {
  res: string;
  actions: Action[];
}

export interface ExecutionResult {
  sysResults: Action[];
  cliActions: Action[];
}

type ActionMeta = Pick<Action, "type" | "target">;


export interface ActionHandler {
  execute(
    projectId: string,
    safePath: string,
    action: Action,
    context: {
      aggregatedReadResults: { target: string; content: string }[];
      sysResults: Action[];
      cliActions: Action[];
    },
    signal?: AbortSignal
  ): void | Promise<void>;
}

export class BaseActionEngine {
  public static sysResults: Action[] = [];
  public static cliActions: Action[] = [];
  public static skippedSYSactions: ActionMeta[] = []
  public static ReadResults: { target: string; content: string }[] = [];
  public static FileActions = ["READ", "WRITE", "DELETE", "UPDATE"]


  private static handlers: Map<string, ActionHandler> = new Map([
    ["READ", new ReadHandler()],
    ["WRITE", new WriteHandler()],
    ["DELETE", new DeleteHandler()],
    ["UPDATE", new UpdateHandler()],
    ["WORKFLOW", new WorkflowHandler()],
    ["SWITCH-AG", new SwitchHandler()],
  ]);

  // --- Utility Methods (unchanged) ---
  public static parseResponse(res: string): ActionResponse {
    logger.debug(`[${MODULE}] Parsing LLM response...`);

    try {
      const trimmed = res.trim();

      // Strategy 1: Try to parse the whole trimmed string directly
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          logger.debug(`[${MODULE}] Direct JSON parse succeeded.`);
          return parsed as ActionResponse;
        }
      } catch {
        // Not a valid JSON object – continue to fallback strategies
      }

      // Strategy 2: Extract JSON from markdown code blocks
      const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)\n\s*```/g;
      let match: RegExpExecArray | null;
      while ((match = codeBlockRegex.exec(trimmed)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (parsed && typeof parsed === "object") {
            logger.debug(`[${MODULE}] Extracted JSON from markdown code block.`);
            return parsed as ActionResponse;
          }
        } catch {
          // Continue searching for another code block
        }
      }

      // Strategy 3: Find the first '{' or '[' and extract a balanced JSON object/array
      const firstBraceIndex = trimmed.search(/[{\[]/);
      if (firstBraceIndex !== -1) {
        const jsonCandidate = this.extractBalancedJson(trimmed, firstBraceIndex);
        if (jsonCandidate) {
          try {
            const parsed = JSON.parse(jsonCandidate);
            if (parsed && typeof parsed === "object") {
              logger.debug(`[${MODULE}] Extracted JSON using brace matching.`);
              return parsed as ActionResponse;
            }
          } catch {
            // Not valid JSON – fall through
          }
        }
      }

      // If all strategies fail, throw an error
      throw new Error("No valid JSON object found in response");
    } catch (e: any) {
      logger.error(`[${MODULE}] Failed to parse response: ${e.message}`);
      throw new Error("Invalid JSON response");
    }
  }

  /**
   * Extract a balanced JSON string starting at the given index.
   * Supports both objects `{...}` and arrays `[...]`.
   */
  static extractBalancedJson(str: string, startIdx: number): string | null {
    const openChar = str[startIdx];
    const closeChar = openChar === '{' ? '}' : (openChar === '[' ? ']' : null);
    if (!closeChar) return null;

    let balance = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < str.length; i++) {
      const ch = str[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (ch === '\\') {
        escape = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === openChar) balance++;
        if (ch === closeChar) balance--;

        if (balance === 0) {
          return str.substring(startIdx, i + 1);
        }
      }
    }
    return null;
  }

  public static getActions(res: string | null): Action[] | null {
    if (!res) return null;
    const response = this.parseResponse(res);
    if (response.actions && response.actions.length > 0) {
      logger.info(`[${MODULE}] Actions Derived: ${JSON.stringify(response.actions)}`);
      return response.actions;
    }
    logger.warn(`[${MODULE}] No actions found`);
    return null;
  }

  public static getPath(input: string): { path: string; device: "CLI" | "SYS" } | null {
    if (!input) return null;
    const match = input.match(/^(CLI|SYS):(.*)$/);
    if (!match) return null;
    return {
      device: match[1] as "CLI" | "SYS",
      path: match[2].trim(),
    };
  }

  public static resolveSafePath(projectId: string, relativePath: string): string {
    const projectPath = ProjectStateRepository.getProjectPath(projectId);
    const resolved = path.resolve(projectPath, relativePath);
    logger.debug(`[${MODULE}] Resolved path: ${resolved}`);
    return resolved;
  }

  static getAggregatedReadContext(): string {
    if (!this.ReadResults.length) return "";
    return `# READ ACTION RESULTS:
${this.ReadResults
        .map(r => `\`\`\`#${r.target}:\n${r.content}\`\`\``)
        .join("\n\n")}
`;
  }

  static getSkippedSteps(): string {
    if (!this.skippedSYSactions) { return "NO ACTIONS SKIPPED" }
    return `# SKIPPED ACTIONS:
${this.skippedSYSactions
        .map(ac => `# ${ac.type} - ${ac.target}`)
        .join("\n\n")
      }
    
`
  }

  // --- Execution Orchestration ---
  public static async executeActions(projectId: string, actions: Action[] | null, signal?: AbortSignal): Promise<ExecutionResult> {
    let readActionEncountered = false
    if (!actions) {
      logger.warn(`[${MODULE}] No actions to execute`);
      return { sysResults: [], cliActions: [] };
    }

    // Reset per‑cycle aggregation
    this.ReadResults = [];
    this.cliActions = [];
    this.sysResults = [];
    this.skippedSYSactions = [];

    for (const act of actions) {
      if (signal?.aborted) {
        logger.warn(`[${MODULE}] Actions execution aborted for project ${projectId}`);
        throw new Error("Aborted by user or system");
      }
      try {

        let safePath = ""

        if (this.FileActions.includes(act.type)) {

          const parsedPath = this.getPath(act.target);
          if (!parsedPath) {
            logger.warn(`[${MODULE}] Invalid target format: ${act.target}`);
            continue;
          }

          // CLI actions: encode and store separately
          if (parsedPath.device === "CLI") {
            const encodedAction: Action = {
              type: act.type,
              target: parsedPath.path,
              content: Buffer.from(act.content || "").toString("base64"),
            };
            this.cliActions.push(encodedAction);
            continue;
          }

          safePath = this.resolveSafePath(projectId, parsedPath.path);

        } else {
          safePath = act.target
        }


        // If Read request encountered then only perform read and skip the rest
        if (act.type === "READ") { readActionEncountered = true }
        if (readActionEncountered && act.type !== "READ") {
          this.skippedSYSactions.push({
            type: act.type,
            target: act.target
          });
          continue
        }

        // SYS actions: delegate to appropriate handler
        const handler = this.handlers.get(act.type);
        if (!handler) {
          logger.warn(`[${MODULE}] Unknown action type: ${act.type}`);
          continue;
        }

        await handler.execute(projectId, safePath, act, {
          aggregatedReadResults: this.ReadResults,
          sysResults: this.sysResults,
          cliActions: this.cliActions,
        }, signal);
      } catch (err: any) {
        logger.error(`[${MODULE}] Action failed: ${err.message}`);
      }
    }

    //     if (this.aggregatedReadResults.length) {
    //       logger.info(`[${MODULE}] Updating the LLM with READ contents`)
    //       let llm = llmInstances.get(projectId);
    //       if (!llm) { llm = new OllamaAdapter(); }
    //       const input = `
    // These are the result of the READ request from previous response,
    // ${this.getAggregatedReadContext()}

    // And there might be some responses, that were skipped due to this READ actions:
    // ${this.getSkippedSteps()}

    // *See the CONVERSATION HISTORY* to know about what you were doing after reading,
    // and also consider any skipped ACTIONS.
    // RESPOND ACCORDINGLY
    // `

    //       console.log(`INPUT CREATED FROM READ:\n${input}`)
    //       const RES = await Orchestrator.handleSystemInput(projectId, input, llm);
    //       console.log("LLM OUTPUT:", RES.res);
    //       console.log("ACTIONS:", RES.actions);

    //     }
    //     this.aggregatedReadResults = []

    if (signal?.aborted) {
      logger.warn(`[${MODULE}] Actions execution aborted before forwarding to client IDE`);
      throw new Error("Aborted by user or system");
    }

    if (this.cliActions.length > 0) {
      try {
        await fetch("http://localhost:4500/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actions: this.cliActions }),
          signal
        });
        console.log(`CLI ACTIONS: ${JSON.stringify(this.cliActions)}`)
        logger.info(`[${MODULE}] CLI actions successfully forwarded to client IDE.`);
      } catch (err: any) {
        if (err.name === 'AbortError' || signal?.aborted) {
          logger.warn(`[${MODULE}] CLI actions forwarding aborted.`);
          throw new Error("Aborted by user or system");
        }
        logger.error(`[${MODULE}] Failed to forward CLI actions to client IDE: ${err.message}`);
      }
    }

    return {
      sysResults: this.sysResults,
      cliActions: this.cliActions,
    };
  }
}