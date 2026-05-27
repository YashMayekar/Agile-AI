import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { systemStatuses } from "../api/project.controller";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path/win32";

const MODULE = "ollama.adapter.ts";
dotenv.config();
const OLLAMA_URL = process.env.OLLAMA_URL;

async function loadPrompt() {
  const filePath = path.join(process.cwd(), 'src/templates', 'intent-prompt.md');
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
}

export class OllamaAdapter implements LLMAdapter {
  private model: string = "gemma4:e4b";
  private intent_prompt: string = "";

  async WarmUp(input?: string): Promise<void> {
    logger.info(`[${MODULE}] Warming up the model...`);
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: `Hello, This is a warm-up call, Do not reply.` }],
        stream: false,
        think: false,
        keep_alive: "50m",
      }),
    });
    const data = await response.json();
    return data.message.content;
  }

  public async GetSummary(
    projectId: string,
    input: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    logger.info(`[${MODULE}] Generating summary for project ${projectId}...`);
    const systemPrompt = `You are a helpful assistant that summarizes project documents context without missing any important information for the user.`;
    try {
      const startTime = Date.now();
      systemStatuses.set(projectId, { object: "", message: `UNDERSTANDING INTENT` });
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gemma4:e4b",
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input }
          ],
          stream: false,
          think: false,
          keep_alive: "50m",
        }),
        signal: options?.signal
      });
      const data = await response.json();
      const durationMs = Date.now() - startTime;
      logger.debug(`[${MODULE}] Summary generated in ${durationMs} ms.`);
      systemStatuses.set(projectId, { object: "", message: `DONE` });
      return data.message.content || "UNKNOWN";
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error("Aborted by user or system");
      logger.error(`[${MODULE}] Failed to generate summary: ${err}`);
      return "UNKNOWN";
    }
  }

  public async GetIntent(
    projectId: string,
    input: string,
    historyText: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    this.intent_prompt = await loadPrompt();
    const systemPrompt = this.intent_prompt + "\n\n" + "Last LLM response:\n" + historyText + "\n\n" + "Output the intent as a JSON object with the specified format and rules.";
    try {
      const startTime = Date.now();
      systemStatuses.set(projectId, { object: "", message: `UNDERSTANDING INTENT` });
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gemma4:e4b",
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input }
          ],
          stream: false,
          think: true,
          keep_alive: "50m",
          format: {
            type: "object",
            properties: {
              actions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["READ", "WRITE", "UPDATE", "DELETE", "SWITCH-AG", "WORKFLOW"] },
                    target: { type: "string", description: "CLI:<path>, SYS:<path>, <agent_name>, NEXT-STEP, or <StepId>" },
                    content: { type: "string", description: "Required only for WRITE and UPDATE actions" }
                  },
                  required: ["type", "target"],
                  allOf: [
                    { if: { properties: { type: { enum: ["WRITE", "UPDATE"] } } }, then: { required: ["content"] } }
                  ]
                }
              }
            },
            required: ["actions"]
          }
        }),
        signal: options?.signal
      });
      const data = await response.json();
      const durationMs = Date.now() - startTime;
      logger.debug(`[${MODULE}] Intent detection completed in ${durationMs} ms.`);
      systemStatuses.set(projectId, { object: "", message: `DONE` });
      return data.message.content || "UNKNOWN";
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error("Aborted by user or system");
      logger.error(`[${MODULE}] Failed to detect intent: ${err}`);
      return JSON.stringify({ actions: [] });
    }
  }

  async GetWorkFlowType(projectId: string, input: string, options?: { signal?: AbortSignal }): Promise<any> {
    try {
      let thinking: string | boolean = true;
      if (this.model === "gpt-oss:20b") thinking = "low";
      logger.debug(`[${MODULE}] Fetching project workflow type.`);
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"` }],
          stream: false,
          think: thinking,
          keep_alive: "30m",
        }),
        signal: options?.signal
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const data = await response.json();
      return data.message.content;
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error("Aborted by user or system");
      throw err;
    }
  }

  async executeAction(
    projectId: string,
    params: { systemPrompt: string; userPrompt: string; dynamicContext?: string; history?: { role: string; content: string }[] },
    options?: { signal?: AbortSignal }
  ): Promise<any> {
    try {
      let thinking: string | boolean = true;
      if (this.model === "gpt-oss:20b") thinking = "medium";
      logger.debug(`[${MODULE}] Generating non‑streaming response.`);
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            ...(params.history || []),
            { role: 'user', content: `${params.dynamicContext ? `[SYSTEM AUTOMATED CONTEXT INJECTION - THIS IS BACKGROUND INFO, DO NOT REPLY TO IT DIRECTLY]\n${params.dynamicContext}\n[END CONTEXT]\n\n` : ''}${params.userPrompt}` }
          ],
          stream: false,
          think: thinking,
          keep_alive: "30m",
        }),
        signal: options?.signal
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const data = await response.json();
      return data.message.content;
    } catch (err: any) {
      if (err.name === 'AbortError') throw new Error("Aborted by user or system");
      throw err;
    }
  }

  async *generate(
    projectId: string,
    params: { systemPrompt: string; userPrompt: string; dynamicContext?: string; history?: { role: string; content: string }[] },
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<{ res: string | null; tools: string | null; think?: string | null; done: boolean }> {
    const useChat = true;
    const endpoint = useChat ? `${OLLAMA_URL}/api/chat` : `${OLLAMA_URL}/api/generate`;
    let thinking: string | boolean = false;
    if (this.model === "gpt-oss:20b") thinking = "medium";
    logger.info(`[${MODULE}] Connecting with model: ${this.model}`);

    let requestBody: any = {
      model: this.model,
      stream: true,
      keep_alive: "50m",
    };
    if (useChat) {
      requestBody.messages = [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userPrompt }
      ];
      if (this.model !== "ministral-3:14b") requestBody.think = thinking;
    } else {
      requestBody.system = params.systemPrompt;
      requestBody.prompt = params.userPrompt;
      if (this.model !== "ministral-3:14b") requestBody.think = thinking;
    }

    systemStatuses.set(projectId, { object: "", message: `CONNECTING TO ${this.model} model` });


    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        logger.warn(`[${MODULE}] Request aborted for project ${projectId}`);
      });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options?.signal
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const startTime = Date.now();
    logger.info(`[${MODULE}] Streaming response...`);
    let thinkingLogged = false;

    try {
      while (true) {
        if (options?.signal?.aborted) throw new Error("Aborted by user or system");
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          try {
            const data = JSON.parse(line);
            let content = null;
            let tool = null;
            let thinkContent = null;
            if (useChat) {
              content = data.message?.content || null;
              tool = data.message?.tool_calls || null;
              thinkContent = data.message?.thinking || null;
            } else {
              content = data.response || null;
              thinkContent = data.thinking || null;
            }
            const isDone = data.done === true;
            if (!isDone) {
              if (thinkContent) {
                systemStatuses.set(projectId, { object: "LLM", message: 'THINKING' });
              } else if (content) {
                if (!thinkingLogged) {
                  logger.debug(`[${MODULE}] Total thinking time: ${Date.now() - startTime} ms.`);
                  thinkingLogged = true;
                }
                systemStatuses.set(projectId, { object: "LLM", message: 'RESPONDING' });
              }
            }
            yield { res: content, tools: tool, think: thinkContent, done: isDone };
            if (isDone) return;
          } catch (err) {
            logger.error(`[${MODULE}] Failed to parse chunk: ${line}`, { error: err });
          }
        }
      }
      yield { res: null, tools: null, done: true };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        logger.warn(`[${MODULE}] Stream aborted for project ${projectId}`);
        throw new Error("Aborted by user or system");
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
  }
}