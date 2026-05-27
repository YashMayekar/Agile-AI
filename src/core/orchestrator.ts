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
import { ProjectStateRepository } from "./project-state/project-state.repository";
import projectProcessInfo from "../api/project.controller";

const MODULE = "orchestrator.ts";

export class Orchestrator {
  public static FullPrompt: string = "";
  public static context: string = "";
  private static currentWorkflow: WorkflowStep | null = null;
  private static state: any = null;
  private static ExecutionLock: boolean = false;
  private static LastAgent: string = "";
  private static LastStepName: string = "";

  static async *handleUserInput(
    projectId: string,
    userInput: string,
    llm?: OllamaAdapter,
    planning: boolean = true,
signal?: AbortSignal
  ): AsyncGenerator<{ res: string | null; tools?: any; think?: string | null; done: boolean }, any, unknown> {
if (signal?.aborted) throw new Error("Aborted by user or system");

    
    ExecutionLock.acquire(projectId);
    this.ExecutionLock = true;
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`);
    systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });

    this.state = ProjectStateRepository.load(projectId) || null;
    let fullResponse: string = "";
    let agent: string = "analyst";
    let currentStepID = Number(this.state?.currentStepId) || 1;
    let workflowFile = this.state?.workflowFile || "greenfield.yaml";


    if (planning) {
      try {
        WorkflowEngine.loadWorkflow(workflowFile);
        this.currentWorkflow = WorkflowEngine.getStepById(currentStepID);
        this.state.currentAgent = this.currentWorkflow?.agent;
        this.state.currentStepName = this.currentWorkflow?.name;
        this.state.systemStatus = `Executing step: ${this.currentWorkflow?.name || "Unknown Step"}`;
        ProjectStateRepository.save(projectId, this.state);
      } catch (e) {
        logger.error(`[${MODULE}] Error in loading workflow step: ${e}`);
      }

      try {
        if (!this.currentWorkflow) throw new Error("Workflow step not found");
        agent = this.state.currentAgent || this.currentWorkflow.agent;
        if (this.currentWorkflow.creates) {
          for (const file of this.currentWorkflow.creates) {
            if (!this.state.documents[file]) {
              this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
            }
          }
        }
      } catch (e) {
        logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
      }

      let requiredFiles = "";
      try {
        if (this.currentWorkflow?.requires) {
          for (const file of this.currentWorkflow.requires) {
            const safePath = BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
            if (!fs.existsSync(safePath)) {
              logger.warn(`[${MODULE}] Required file not found: ${file}\nExpected at path: ${safePath}`);
              requiredFiles += `- ${file}\n`;
            }
          }
        }
      } catch (e) {
        logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
      }
    }

    try {
      const llmInstance = llm ?? new OllamaAdapter();
      try {
        this.context = ContextBuilder.buildFullContext(projectId, currentStepID, agent);
      } catch (e) {
        logger.error(`[${MODULE}] Failed to build context: ${e}`);
      }

      const CLITree = await ContextBuilder.getClientFS(projectId);
      let clientData = "";
      if (CLITree) {
        clientData = `
# HERE is the CLIENT SIDE FILE STRUCTURE, if you need to perform actions on client side:
\`\`\`
${JSON.stringify(ProjectStateRepository.load(projectId)?.dynamicContext.fileTree)}
\`\`\`
# Here the paths with no extension '.' are just empty folders
IF You want to acces or write in the client side, proide target path as CLI:<folder>/<filename>.extension
`;
      }

      let systemData = ``;
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
`;
            }
          }
        } catch (e) {
          logger.error(`[${MODULE}] Error in loading system data: ${e}`);
        }

        const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);
        const historyText = structuredHistory.map(h => `${h.role}: ${h.content}`).join("\n");
        const lastAssistantMessage = structuredHistory.reverse().find(h => h.role === "assistant")?.content || "";

        let intent = "";
        let actions: Action[] | null = null;
        if (lastAssistantMessage) {
          // Pass signal to GetIntent
          intent = await llmInstance.GetIntent(projectId, userInput, lastAssistantMessage, { signal });
          if (signal?.aborted) throw new Error("Aborted by user or system");
          try {
            BaseActionEngine.parseResponse(intent);
          } catch (e) {
            logger.error(`[${MODULE}] Failed to parse intent response: ${e}. Intent: ${intent}`);
            intent = "";
            const retry = `The assistant's last message was not in the correct format. Please Try again \n${userInput}`;
            logger.warn(`[${MODULE}] Retrying intent detection.`);
            intent = await llmInstance.GetIntent(projectId, retry, lastAssistantMessage, { signal });
            if (signal?.aborted) throw new Error("Aborted by user or system");
            BaseActionEngine.parseResponse(intent);
          }
          actions = BaseActionEngine.getActions(intent);
          await BaseActionEngine.executeActions(projectId, actions, signal);
        }

        let data = "";
        if (this.currentWorkflow?.requires) {
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
                const fileContent = fs.readFileSync(safePath, "utf-8") || "FILE NOT FOUND";
                summary = await llmInstance.GetSummary(projectId, fileContent, { signal });
                if (signal?.aborted) throw new Error("Aborted by user or system");
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
          },
          { signal }
        );

        for await (const chunk of stream) {
          if (signal?.aborted) throw new Error("Aborted by user or system");
          yield chunk;
          if (chunk.res) fullResponse += chunk.res;
        }
      } else {
        // coding agent branch
        try {
          this.context = ContextBuilder.getAgentPrompt("coding");
          console.log("Entered Coding prompt");
        } catch (e) {
          logger.error(`[${MODULE}] Failed to load coding prompt: ${e}`);
          this.context = "You are a coding assistant.";
        }

        this.state = ProjectStateRepository.load(projectId) || null;
        if (this.state) {
          this.state.systemStatus = `Executing User Request in coding agent`;
          this.state.currentStepName = "Executing User Request";
          this.state.currentAgent = "coding";
          this.state.phase = "coding";
          StateManager.save(projectId, this.state);
        }

        const structuredHistory = MemoryManager.getLastNConversationsStructured(projectId, 2);
        this.FullPrompt = `
# Here is the file structure from the user's side
${ContextBuilder.getClientFS(projectId)}

# This is your conversation history with the user:
${JSON.stringify(structuredHistory)}

# Here is the output format:
{
    "res": "DETAILED explanation, preview, confirmation request, or final response",
    "actions": [
        {
            "type": "READ" | "WRITE" | "UPDATE" | "DELETE" ,
            "target": "CLI:<path>",
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
- Any file you want to create on the user's side must be targeted as CLI:<path>. For example, CLI:src/utils/helper.js

## DELETE
- MUST ask for confirmation BEFORE deleting any file. For example, "Are you sure you want to delete <target>? This action cannot be undone."

## READ
- You can read any file from the system by specifying the target as  CLI:<path>. For example, to read a file named "report.md" in the docs folder, your action would be: 

# Now respond to the user's message: 
**${userInput}**`;

        const stream = llmInstance.generate(
          projectId,
          {
            systemPrompt: this.context || "You are an assistant.",
            userPrompt: this.FullPrompt,
          },
          { signal }
        );

        for await (const chunk of stream) {
          if (signal?.aborted) throw new Error("Aborted by user or system");
          yield chunk;
          if (chunk.res) fullResponse += chunk.res;
        }
        let actions: Action[] | null = BaseActionEngine.getActions(fullResponse);
        await BaseActionEngine.executeActions(projectId, actions, signal);
      }

      logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);
      await MemoryManager.addConversation(projectId, userInput, fullResponse, agent);
      systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });
      logger.info(`[${MODULE}] PROCESSING COMPLETED`);
    } catch (error: any) {
      if (error.message === "Aborted by user or system") {
        logger.warn(`[${MODULE}] Aborted for project ${projectId}`);
        yield { res: "[System] Operation cancelled because process was aborted.", done: true };
      } else {
        logger.error(`[${MODULE}] Processing failed: ${error.message}`);
        yield { res: `Error: ${error.message}`, done: true };
      }
    } finally {
      ExecutionLock.release(projectId);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`);
    }
  }

  static async *handleSystemInput(
    projectId: string,
    systemInput: string,
    llm?: OllamaAdapter,
    signal?: AbortSignal
  ): AsyncGenerator<{ res: string | null; tools?: any; think?: string | null; done: boolean }, any, unknown> {
    if (signal?.aborted) throw new Error("Aborted by user or system");

    ExecutionLock.acquire(projectId);
    logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`);
    systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });

    this.state = ProjectStateRepository.load(projectId) || null;
    let fullResponse: string = "";
    let agent: string = this.state?.currentAgent || "";
    let currentStepID = Number(this.state?.currentStepId) || 1;
    let workflowFile = this.state?.workflowFile || "greenfield.yaml";

    try {
      WorkflowEngine.loadWorkflow(workflowFile);
      this.currentWorkflow = WorkflowEngine.getStepById(currentStepID);
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading workflow step: ${e}`);
    }

    this.state.systemStatus = this.currentWorkflow ? `Executing step: ${this.currentWorkflow.name}` : "Executing step";
    this.state.currentAgent = this.currentWorkflow?.agent || this.state.currentAgent;
    this.state.currentStepName = this.LastStepName;
    StateManager.save(projectId, this.state);

    try {
      if (!this.currentWorkflow) throw new Error("Workflow step not found");
      agent = this.currentWorkflow.agent;
      if (this.currentWorkflow.creates) {
        for (const file of this.currentWorkflow.creates) {
          if (!this.state.documents[file]) {
            this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
          }
        }
      }
    } catch (e) {
      logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
    }

    try {
      const llmInstance = llm ?? new OllamaAdapter();
      try {
        this.context = ContextBuilder.buildFullContext(projectId, currentStepID, agent);
      } catch (e) {
        logger.error(`[${MODULE}] Failed to build context: ${e}`);
      }

      // Required files data (similar to planning branch)
      let data = "";
      if (this.currentWorkflow?.requires) {
        data = `REQUIRED FILES for this step:\n\n`;
        for (const file of this.currentWorkflow.requires) {
          const safePath = BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
          if (fs.existsSync(safePath)) {
            logger.info(`[${MODULE}] Required file found: ${file}`);
            const summaryPath = BaseActionEngine.resolveSafePath(projectId, `docs/summary.${file}`);
            let summary = "";
            if (fs.existsSync(summaryPath)) {
              summary = fs.readFileSync(summaryPath, "utf-8");
            } else {
              const fileContent = fs.readFileSync(safePath, "utf-8") || "FILE NOT FOUND";
              summary = await llmInstance.GetSummary(projectId, fileContent, { signal });
              if (signal?.aborted) throw new Error("Aborted by user or system");
              fs.writeFileSync(summaryPath, summary, "utf-8");
            }
            data += `#${file}\n \`\`\`${summary}\`\`\`\n\n`;
          } else {
            logger.warn(`[${MODULE}] Required file not found: ${file}`);
            data += `#${file}\n \`\`\`FILE NOT FOUND\`\`\`\n\n`;
          }
        }
      }

      const fullPrompt = `
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
          userPrompt: fullPrompt,
        },
        { signal }
      );

      for await (const chunk of stream) {
        if (signal?.aborted) throw new Error("Aborted by user or system");
        yield chunk;
        if (chunk.res) fullResponse += chunk.res;
      }

      logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);
      await MemoryManager.addConversation(projectId, systemInput, fullResponse, agent);
      systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });
      logger.info(`[${MODULE}] PROCESSING COMPLETED`);
    } catch (error: any) {
      if (error.message === "Aborted by user or system") {
        logger.warn(`[${MODULE}] Aborted for project ${projectId}`);
        yield { res: "[System] Operation cancelled because process was aborted.", done: true };
      } else {
        logger.error(`[${MODULE}] Processing failed: ${error.message}`);
        yield { res: `Error: ${error.message}`, done: true };
      }
    } finally {
      ExecutionLock.release(projectId);
      logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`);
    }
  }
}