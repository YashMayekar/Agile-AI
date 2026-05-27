"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const ollama_adapter_1 = require("../llm/ollama.adapter");
const logger_1 = require("../utils/logger");
const base_engine_1 = require("./action-engine/base-engine");
const context_builder_1 = require("./context-builder");
const execution_lock_1 = require("./execution-lock");
const memory_manager_1 = require("./memory-manager");
const workflow_engine_1 = require("./workflow-engine");
const project_controller_1 = require("../api/project.controller");
const state_manager_1 = require("./state-manager");
const fs_1 = __importDefault(require("fs"));
const project_state_repository_1 = require("./project-state/project-state.repository");
const MODULE = "orchestrator.ts";
class Orchestrator {
    static async *handleUserInput(projectId, userInput, llm, planning = true, signal) {
        if (signal?.aborted)
            throw new Error("Aborted by user or system");
        execution_lock_1.ExecutionLock.acquire(projectId);
        this.ExecutionLock = true;
        logger_1.logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`);
        project_controller_1.systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });
        this.state = project_state_repository_1.ProjectStateRepository.load(projectId) || null;
        let fullResponse = "";
        let agent = "analyst";
        let currentStepID = Number(this.state?.currentStepId) || 1;
        let workflowFile = this.state?.workflowFile || "greenfield.yaml";
        if (planning) {
            try {
                workflow_engine_1.WorkflowEngine.loadWorkflow(workflowFile);
                this.currentWorkflow = workflow_engine_1.WorkflowEngine.getStepById(currentStepID);
                this.state.currentAgent = this.currentWorkflow?.agent;
                this.state.currentStepName = this.currentWorkflow?.name;
                this.state.systemStatus = `Executing step: ${this.currentWorkflow?.name || "Unknown Step"}`;
                project_state_repository_1.ProjectStateRepository.save(projectId, this.state);
            }
            catch (e) {
                logger_1.logger.error(`[${MODULE}] Error in loading workflow step: ${e}`);
            }
            try {
                if (!this.currentWorkflow)
                    throw new Error("Workflow step not found");
                agent = this.state.currentAgent || this.currentWorkflow.agent;
                if (this.currentWorkflow.creates) {
                    for (const file of this.currentWorkflow.creates) {
                        if (!this.state.documents[file]) {
                            this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
                        }
                    }
                }
            }
            catch (e) {
                logger_1.logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
            }
            let requiredFiles = "";
            try {
                if (this.currentWorkflow?.requires) {
                    for (const file of this.currentWorkflow.requires) {
                        const safePath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
                        if (!fs_1.default.existsSync(safePath)) {
                            logger_1.logger.warn(`[${MODULE}] Required file not found: ${file}\nExpected at path: ${safePath}`);
                            requiredFiles += `- ${file}\n`;
                        }
                    }
                }
            }
            catch (e) {
                logger_1.logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
            }
        }
        try {
            const llmInstance = llm ?? new ollama_adapter_1.OllamaAdapter();
            try {
                this.context = context_builder_1.ContextBuilder.buildFullContext(projectId, currentStepID, agent);
            }
            catch (e) {
                logger_1.logger.error(`[${MODULE}] Failed to build context: ${e}`);
            }
            const CLITree = await context_builder_1.ContextBuilder.getClientFS(projectId);
            let clientData = "";
            if (CLITree) {
                clientData = `
# HERE is the CLIENT SIDE FILE STRUCTURE, if you need to perform actions on client side:
\`\`\`
${JSON.stringify(project_state_repository_1.ProjectStateRepository.load(projectId)?.dynamicContext.fileTree)}
\`\`\`
# Here the paths with no extension '.' are just empty folders
IF You want to acces or write in the client side, proide target path as CLI:<folder>/<filename>.extension
`;
            }
            let systemData = ``;
            if (planning) {
                try {
                    const docsPath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, "docs");
                    if (fs_1.default.existsSync(docsPath)) {
                        const files = fs_1.default.readdirSync(docsPath);
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
                }
                catch (e) {
                    logger_1.logger.error(`[${MODULE}] Error in loading system data: ${e}`);
                }
                const structuredHistory = memory_manager_1.MemoryManager.getLastNConversationsStructured(projectId, 2);
                const historyText = structuredHistory.map(h => `${h.role}: ${h.content}`).join("\n");
                const lastAssistantMessage = structuredHistory.reverse().find(h => h.role === "assistant")?.content || "";
                let intent = "";
                let actions = null;
                if (lastAssistantMessage) {
                    // Pass signal to GetIntent
                    intent = await llmInstance.GetIntent(projectId, userInput, lastAssistantMessage, { signal });
                    if (signal?.aborted)
                        throw new Error("Aborted by user or system");
                    try {
                        base_engine_1.BaseActionEngine.parseResponse(intent);
                    }
                    catch (e) {
                        logger_1.logger.error(`[${MODULE}] Failed to parse intent response: ${e}. Intent: ${intent}`);
                        intent = "";
                        const retry = `The assistant's last message was not in the correct format. Please Try again \n${userInput}`;
                        logger_1.logger.warn(`[${MODULE}] Retrying intent detection.`);
                        intent = await llmInstance.GetIntent(projectId, retry, lastAssistantMessage, { signal });
                        if (signal?.aborted)
                            throw new Error("Aborted by user or system");
                        base_engine_1.BaseActionEngine.parseResponse(intent);
                    }
                    actions = base_engine_1.BaseActionEngine.getActions(intent);
                    await base_engine_1.BaseActionEngine.executeActions(projectId, actions);
                }
                let data = "";
                if (this.currentWorkflow?.requires) {
                    data = `REQUIRED FILES for this step:\n\n`;
                    for (const file of this.currentWorkflow.requires) {
                        const safePath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
                        if (fs_1.default.existsSync(safePath)) {
                            logger_1.logger.info(`[${MODULE}] Required file found: ${file}`);
                            const summaryPath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, `docs/summary.${file}`);
                            let summary = "";
                            if (fs_1.default.existsSync(summaryPath)) {
                                logger_1.logger.info(`[${MODULE}] Loading existing summary for required file: ${file}`);
                                summary = fs_1.default.readFileSync(summaryPath, "utf-8");
                            }
                            else {
                                logger_1.logger.info(`[${MODULE}] Generating summary for required file: ${file}`);
                                const fileContent = fs_1.default.readFileSync(safePath, "utf-8") || "FILE NOT FOUND";
                                summary = await llmInstance.GetSummary(projectId, fileContent, { signal });
                                if (signal?.aborted)
                                    throw new Error("Aborted by user or system");
                                fs_1.default.writeFileSync(summaryPath, summary, "utf-8");
                            }
                            data += `#${file}\n \`\`\`${summary}\`\`\`\n\n`;
                        }
                        else {
                            logger_1.logger.warn(`[${MODULE}] Required file not found: ${file}`);
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
                const stream = llmInstance.generate(projectId, {
                    systemPrompt: context_builder_1.ContextBuilder.buildFullContext(projectId, currentStepID, agent) || "You are an assistant.",
                    userPrompt: this.FullPrompt,
                }, { signal });
                for await (const chunk of stream) {
                    if (signal?.aborted)
                        throw new Error("Aborted by user or system");
                    yield chunk;
                    if (chunk.res)
                        fullResponse += chunk.res;
                }
            }
            else {
                // coding agent branch
                try {
                    this.context = context_builder_1.ContextBuilder.getAgentPrompt("coding");
                    console.log("Entered Coding prompt");
                }
                catch (e) {
                    logger_1.logger.error(`[${MODULE}] Failed to load coding prompt: ${e}`);
                    this.context = "You are a coding assistant.";
                }
                this.state = project_state_repository_1.ProjectStateRepository.load(projectId) || null;
                if (this.state) {
                    this.state.systemStatus = `Executing User Request in coding agent`;
                    this.state.currentStepName = "Executing User Request";
                    this.state.currentAgent = "coding";
                    this.state.phase = "coding";
                    state_manager_1.StateManager.save(projectId, this.state);
                }
                const structuredHistory = memory_manager_1.MemoryManager.getLastNConversationsStructured(projectId, 2);
                this.FullPrompt = `
# Here is the file structure from the user's side
${context_builder_1.ContextBuilder.getClientFS(projectId)}

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
                const stream = llmInstance.generate(projectId, {
                    systemPrompt: this.context || "You are an assistant.",
                    userPrompt: this.FullPrompt,
                }, { signal });
                for await (const chunk of stream) {
                    if (signal?.aborted)
                        throw new Error("Aborted by user or system");
                    yield chunk;
                    if (chunk.res)
                        fullResponse += chunk.res;
                }
                let actions = base_engine_1.BaseActionEngine.getActions(fullResponse);
                await base_engine_1.BaseActionEngine.executeActions(projectId, actions);
            }
            logger_1.logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);
            await memory_manager_1.MemoryManager.addConversation(projectId, userInput, fullResponse, agent);
            project_controller_1.systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });
            logger_1.logger.info(`[${MODULE}] PROCESSING COMPLETED`);
        }
        catch (error) {
            if (error.message === "Aborted by user or system") {
                logger_1.logger.warn(`[${MODULE}] Aborted for project ${projectId}`);
                yield { res: "[System] Operation cancelled because process was aborted.", done: true };
            }
            else {
                logger_1.logger.error(`[${MODULE}] Processing failed: ${error.message}`);
                yield { res: `Error: ${error.message}`, done: true };
            }
        }
        finally {
            execution_lock_1.ExecutionLock.release(projectId);
            logger_1.logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`);
        }
    }
    static async *handleSystemInput(projectId, systemInput, llm, signal) {
        if (signal?.aborted)
            throw new Error("Aborted by user or system");
        execution_lock_1.ExecutionLock.acquire(projectId);
        logger_1.logger.info(`[${MODULE}] EXECUTION LOCK ENABLE - Processing input`);
        project_controller_1.systemStatuses.set(projectId, { object: "", message: "CONNECTING TO gpt-oss:20b model..." });
        this.state = project_state_repository_1.ProjectStateRepository.load(projectId) || null;
        let fullResponse = "";
        let agent = this.state?.currentAgent || "";
        let currentStepID = Number(this.state?.currentStepId) || 1;
        let workflowFile = this.state?.workflowFile || "greenfield.yaml";
        try {
            workflow_engine_1.WorkflowEngine.loadWorkflow(workflowFile);
            this.currentWorkflow = workflow_engine_1.WorkflowEngine.getStepById(currentStepID);
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Error in loading workflow step: ${e}`);
        }
        this.state.systemStatus = this.currentWorkflow ? `Executing step: ${this.currentWorkflow.name}` : "Executing step";
        this.state.currentAgent = this.currentWorkflow?.agent || this.state.currentAgent;
        this.state.currentStepName = this.LastStepName;
        state_manager_1.StateManager.save(projectId, this.state);
        try {
            if (!this.currentWorkflow)
                throw new Error("Workflow step not found");
            agent = this.currentWorkflow.agent;
            if (this.currentWorkflow.creates) {
                for (const file of this.currentWorkflow.creates) {
                    if (!this.state.documents[file]) {
                        this.state.documents[file] = { status: "pending", version: 0, updatedAt: new Date().toISOString() };
                    }
                }
            }
        }
        catch (e) {
            logger_1.logger.error(`[${MODULE}] Error in loading ${agent} prompt: ${e}`);
        }
        try {
            const llmInstance = llm ?? new ollama_adapter_1.OllamaAdapter();
            try {
                this.context = context_builder_1.ContextBuilder.buildFullContext(projectId, currentStepID, agent);
            }
            catch (e) {
                logger_1.logger.error(`[${MODULE}] Failed to build context: ${e}`);
            }
            // Required files data (similar to planning branch)
            let data = "";
            if (this.currentWorkflow?.requires) {
                data = `REQUIRED FILES for this step:\n\n`;
                for (const file of this.currentWorkflow.requires) {
                    const safePath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, `docs/${file}`);
                    if (fs_1.default.existsSync(safePath)) {
                        logger_1.logger.info(`[${MODULE}] Required file found: ${file}`);
                        const summaryPath = base_engine_1.BaseActionEngine.resolveSafePath(projectId, `docs/summary.${file}`);
                        let summary = "";
                        if (fs_1.default.existsSync(summaryPath)) {
                            summary = fs_1.default.readFileSync(summaryPath, "utf-8");
                        }
                        else {
                            const fileContent = fs_1.default.readFileSync(safePath, "utf-8") || "FILE NOT FOUND";
                            summary = await llmInstance.GetSummary(projectId, fileContent, { signal });
                            if (signal?.aborted)
                                throw new Error("Aborted by user or system");
                            fs_1.default.writeFileSync(summaryPath, summary, "utf-8");
                        }
                        data += `#${file}\n \`\`\`${summary}\`\`\`\n\n`;
                    }
                    else {
                        logger_1.logger.warn(`[${MODULE}] Required file not found: ${file}`);
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
            const stream = llmInstance.generate(projectId, {
                systemPrompt: context_builder_1.ContextBuilder.buildFullContext(projectId, currentStepID, agent) || "You are an assistant.",
                userPrompt: fullPrompt,
            }, { signal });
            for await (const chunk of stream) {
                if (signal?.aborted)
                    throw new Error("Aborted by user or system");
                yield chunk;
                if (chunk.res)
                    fullResponse += chunk.res;
            }
            logger_1.logger.debug(`[${MODULE}] Full LLM response:\n${fullResponse}`);
            await memory_manager_1.MemoryManager.addConversation(projectId, systemInput, fullResponse, agent);
            project_controller_1.systemStatuses.set(projectId, { object: "ORCHESTRATOR", message: "IDLE" });
            logger_1.logger.info(`[${MODULE}] PROCESSING COMPLETED`);
        }
        catch (error) {
            if (error.message === "Aborted by user or system") {
                logger_1.logger.warn(`[${MODULE}] Aborted for project ${projectId}`);
                yield { res: "[System] Operation cancelled because process was aborted.", done: true };
            }
            else {
                logger_1.logger.error(`[${MODULE}] Processing failed: ${error.message}`);
                yield { res: `Error: ${error.message}`, done: true };
            }
        }
        finally {
            execution_lock_1.ExecutionLock.release(projectId);
            logger_1.logger.info(`[${MODULE}] EXECUTION LOCK DISABLE - Processing completed`);
        }
    }
}
exports.Orchestrator = Orchestrator;
Orchestrator.FullPrompt = "";
Orchestrator.context = "";
Orchestrator.currentWorkflow = null;
Orchestrator.state = null;
Orchestrator.ExecutionLock = false;
Orchestrator.LastAgent = "";
Orchestrator.LastStepName = "";
