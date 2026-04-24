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
import { SchemaValidator } from "./schema-validator";
import { ProjectStateRepository } from "./project-state/project-state.repository";

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
  private static currentWorkflow: WorkflowStep | null = null;
  private static state: any = null;
  private static ExecutionLock: boolean = false; // if true, only one agent can run at a time, no auto-triggering of next agent

  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter | GeminiAdapter,
    planning: boolean = true,
  ): AsyncGenerator<{ res: string | null; tools?: any; think?: string | null; done: boolean }, any, unknown> {

    ExecutionLock.acquire(projectId);
    this.ExecutionLock = true;
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`)
    systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });

    this.state = ProjectStateRepository.load(projectId);

    let fullResponse: string = "";
    let agent: string = "analyst";
    let currentStepID = Number(this.state.currentStepId) || 1;
    let workflowFile = this.state.workflowFile || "greenfield.yaml";

    if (planning) {
      try {
        WorkflowEngine.loadWorkflow(workflowFile)
        this.currentWorkflow = WorkflowEngine.getStepById(currentStepID)
      } catch (e) {
        logger.error(`[${MODULE}] Error in loading worlflow step: ${e}`)
      }

      try {
        if (!this.currentWorkflow) {
          throw new Error("Workflow step not found");
          // Error handling needs to be implemented...
        }
        agent = this.currentWorkflow.agent;
        if (this.currentWorkflow.creates) {
          for (const file of this.currentWorkflow.creates) {
            if (!this.state.documents[file]) {
              this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
            }
          }
        }

      } catch (e) {
        logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`)
      }

      let requiredFiles = "";
      let missingFilesPrompt = "";
      try {
        if (this.currentWorkflow?.requires) {
          for (const file of this.currentWorkflow.requires) {
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
      if (planning) {
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

        const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);


        // map the structured history to text
        const historyText = structuredHistory.map(h => `${h.role}: ${h.content}`).join("\n");

        // get only last assistant message

        const lastAssistantMessage = structuredHistory.reverse().find(h => h.role === "assistant")?.content || "";

        let intent = "";
        let actions: Action[] | null = null;
        let parsedActions: any = null;
        if (lastAssistantMessage) {
          intent = await llmInstance.GetIntent(projectId, userInput, lastAssistantMessage);
          try {
            parsedActions = BaseActionEngine.parseResponse(intent); // just to validate the response format, the actual actions will be parsed and executed in the next step
          } catch (e) {
            logger.error(`[${MODULE}] Failed to parse intent response: ${e}. Intent: ${intent}`);
            intent = ""; // reset intent to avoid executing invalid actions
            const retry = `The assistant's last message was not in the correct format. Please Try again \n${userInput}`;
            logger.warn(`[${MODULE}] Retrying intent detection with user input and last assistant message. Retry prompt: ${retry}`);
            intent = await llmInstance.GetIntent(projectId, retry, lastAssistantMessage);
            parsedActions = BaseActionEngine.parseResponse(intent);
          }
          actions = BaseActionEngine.getActions(intent);
          const executionResult = await BaseActionEngine.executeActions(projectId, actions);
        }
        // if (lastAssistantMessage) {
        //   const MAX_ATTEMPTS = 0;
        //   let attempt = 0;
        //   let isValid = false;

        //   while (attempt < MAX_ATTEMPTS && !isValid) {

        //     isValid = SchemaValidator.validateIntentResponse(intent);

        //     if (!isValid) {
        //       logger.warn(
        //         `[${MODULE}] Intent schema validation failed (attempt ${attempt + 1}). Intent: ${intent}`
        //       );
        //     }

        //     attempt++;
        //   }

        //   if (isValid) {
        //   } else {
        //     logger.error(
        //       `[${MODULE}] Intent failed schema validation after ${MAX_ATTEMPTS} attempts. Skipping execution.`
        //     );
        //   }

        // } else {
        //   logger.warn(
        //     `[${MODULE}] No assistant message found in history, intent detection might be inaccurate.`
        //   );
        // }

        let data = "";
        if (this.currentWorkflow?.requires) {
          // check if the required files exist in the project's docs folder 
          data = `REQUIRED FILES for this step:\n\n`;
          for (const file of this.currentWorkflow.requires) {
            const safePath = BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
            if (fs.existsSync(safePath)) {
              logger.info(`[${MODULE}] Required file found: ${file}`);

              const summaryPath = BaseActionEngine.resolveSafePath(projectId, `docs/summary.${file}`);
              let summary = "";

              if (fs.existsSync(summaryPath)) {
                logger.info(`[${MODULE}] Loading existing summary for required file: ${file}`);
                summary = fs.readFileSync(summaryPath, "utf-8");
              } else {
                logger.info(`[${MODULE}] Generating summary for required file: ${file}`);
                summary = await llmInstance.GetSummary(projectId, fs.readFileSync(safePath, "utf-8") || "FILE NOT FOUND");
                fs.writeFileSync(summaryPath, summary, "utf-8");
              }

              data += `#${file}\n \`\`\`${summary}\`\`\`\n\n`;
            } else {
              logger.warn(`[${MODULE}] Required file not found: ${file}`);
              data += `#${file}\n \`\`\`FILE NOT FOUND\`\`\`\n\n`;
            }
          }
        }

        console.log(`[${MODULE}] Detected intent: ${intent}`);
        this.FullPrompt = `
${data}

# This is your conversation history with the user:
${historyText}

# Now respond to the user's message: 
**${userInput}**`;

        const stream = llmInstance.generate(
          projectId,
          {
            systemPrompt: ContextBuilder.buildFullContext(projectId, currentStepID, agent) || "You are an assistant.",
            userPrompt: this.FullPrompt,
          }
        );

        for await (const chunk of stream) {
          yield chunk;
          if (chunk.res) {

            fullResponse += chunk.res;
          }
        }
      } else {
        try {
          this.context = ContextBuilder.getAgentPrompt("coding");
        } catch (e) {
          logger.error(`[${MODULE}] Failed to load coding prompt: ${e}`);
          this.context = "You are a coding assistant.";
        }

        const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);

        this.FullPrompt = `
# This is your conversation history with the user:
${JSON.stringify(structuredHistory)}

# Here is the output format:
{
    "res": "DETAILED explanation, preview, confirmation request, or final response",
    "actions": [
        {
            "type": "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG" | "WORKFLOW",
            "target": "CLI:<path>" | "SYS:docs/<filename>.md" | "<agent_name>" | "NEXT-STEP" | "<StepId>",
            "content": "REQUIRED only for WRITE and UPDATE"
        }
    ]
}
## CORE RULES (STRICT)
1. \`res\` is ALWAYS REQUIRED, contains the response to the user. It can be used for confirmations, explanations, previews of file content, or final responses.  
2. \`actions\` is OPTIONAL  
3. NEVER include any text outside the format structure  
4. NEVER put meaningful explanation inside \`actions\`

## WRITE / UPDATE
- MUST include \`content\`
- First give the preview of the content in \`res\` and ask for user confirmation before writing. For example, if you want to write a file, first show the content of the file in \`res\` and ask "Should I write this to <target>?". Only after receiving user confirmation, proceed with the WRITE action in the next response.
- Any markdown documents you create must be stored at SYS:docs/<filename>.md. You can create subfolders in docs if needed. For example, SYS:docs/analysis/result.md
- Any file you want to create on the user's side must be targeted as CLI:<path>. For example, CLI:src/utils/helper.js

## DELETE
- MUST ask for confirmation BEFORE deleting any file. For example, "Are you sure you want to delete <target>? This action cannot be undone."

## READ
- You can read any file from the system by specifying the target as SYS:docs/<filename>.md or from the user by specifying the target as CLI:<path>. For example, to read a file named "report.md" in the docs folder, your action would be: 

## SWITCH-AG
- Use this action to switch to a different agent. For example, if user want to switch to an agent named "architect", your action would be:
- Only switch agent when user explicitly asks for it. NEVER switch agent without user request. For example, if user says "I want to talk to the architect now", then you can respond with a SWITCH-AG action targeting "architect". But if user just says "What do you think about this?", you should NOT switch agent even if architect agent might be better for answering that question.

## WORKFLOW
- To progress through the workflow to next step or user requested step, Then use type "WORKFLOW" and specify the target as "NEXT-STEP" or a specific StepId.

# Now respond to the user's message: 
**${userInput}**`;


        const stream = llmInstance.generate(
          projectId,
          {
            systemPrompt: ContextBuilder.buildFullContext(projectId, currentStepID, agent) || "You are an assistant.",
            userPrompt: this.FullPrompt,
          }
        );

        for await (const chunk of stream) {
          yield chunk;
          if (chunk.res) {
            fullResponse += chunk.res;
          }
        }
      }


      logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);

      await Promise.resolve(MemoryManager.addConversation(projectId, userInput, fullResponse, agent));

      // let actions: Action[] | null
      // actions = BaseActionEngine.getActions(fullResponse)
      // const executionResult = await BaseActionEngine.executeActions(projectId, actions)

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

  static async *handleSystemInput(
    projectId: string,
    systemInput: string,
    llm?: OllamaAdapter | GeminiAdapter,
  ): AsyncGenerator<{ res: string | null; tools?: any; think?: string | null; done: boolean }, any, unknown> {

    ExecutionLock.acquire(projectId);
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`)
    systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });

    this.state = ProjectStateRepository.load(projectId);

    let fullResponse: string = "";
    let agent: string = this.state.currentAgent;
    let currentStepID = Number(this.state.currentStepId);
    let workflowFile = this.state.workflowFile || "greenfield.yaml";


    try {
      WorkflowEngine.loadWorkflow(workflowFile)
      this.currentWorkflow = WorkflowEngine.getStepById(currentStepID)
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading worlflow step: ${e}`)
    }

    this.state.systemStatus = this.currentWorkflow ? `Executing step: ${this.currentWorkflow.name}` : "Executing step";
    this.state.currentAgent = this.currentWorkflow?.agent || this.state.currentAgent;
    this.state.currentStepName = this.currentWorkflow?.name || this.state.currentStepName;
    StateManager.save(projectId, this.state);
    try {
      if (!this.currentWorkflow) {
        throw new Error("Workflow step not found");
        // Error handling needs to be implemented...
      }
      agent = this.currentWorkflow.agent;
      if (this.currentWorkflow.creates) {
        for (const file of this.currentWorkflow.creates) {
          if (!this.state.documents[file]) {
            this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
          }
        }
      }

    } catch (e) {
      logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`)
    }

    let requiredFiles = "";
    let missingFilesPrompt = "";
    try {
      if (this.currentWorkflow?.requires) {
        for (const file of this.currentWorkflow.requires) {
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

      const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);



      const lastAssistantMessage = structuredHistory.reverse().find(h => h.role === "assistant")?.content || "";


      let data = "";
        if (this.currentWorkflow?.requires) {
          // check if the required files exist in the project's docs folder 
          data = `REQUIRED FILES for this step:\n\n`;
          for (const file of this.currentWorkflow.requires) {
            const safePath = BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
            if (fs.existsSync(safePath)) {
              logger.info(`[${MODULE}] Required file found: ${file}`);

              const summaryPath = BaseActionEngine.resolveSafePath(projectId, `docs/summary.${file}`);
              let summary = "";

              if (fs.existsSync(summaryPath)) {
                logger.info(`[${MODULE}] Loading existing summary for required file: ${file}`);
                summary = fs.readFileSync(summaryPath, "utf-8");
              } else {
                logger.info(`[${MODULE}] Generating summary for required file: ${file}`);
                summary = await llmInstance.GetSummary(projectId, fs.readFileSync(safePath, "utf-8") || "FILE NOT FOUND");
                fs.writeFileSync(summaryPath, summary, "utf-8");
              }

              data += `#${file}\n \`\`\`${summary}\`\`\`\n\n`;
            } else {
              logger.warn(`[${MODULE}] Required file not found: ${file}`);
              data += `#${file}\n \`\`\`FILE NOT FOUND\`\`\`\n\n`;
            }
          }
        }


      let FullPrompt = `
This is a SYSTEM GENERATED MESSAGE meant to trigger the agent to perform necessary system level actions.
This is the action performed by the user or system that requires agent's attention:
${systemInput}
        
This is the relevant system data which might be helpful in performing the action:
${data}

Now greet the user and proceed to document generation.
`;

      const stream = llmInstance.generate(
        projectId,
        {
          systemPrompt: ContextBuilder.buildFullContext(projectId, currentStepID, agent) || "You are an assistant.",
          userPrompt: FullPrompt,
        }
      );

      for await (const chunk of stream) {
        yield chunk;
        if (chunk.res) {

          fullResponse += chunk.res;
        }
      }



      logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);

      await Promise.resolve(MemoryManager.addConversation(projectId, systemInput, fullResponse, agent));

      // let actions: Action[] | null
      // actions = BaseActionEngine.getActions(fullResponse)
      // const executionResult = await BaseActionEngine.executeActions(projectId, actions)

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