import { LLMAdapter } from "./llm-adapter.interface";
import { logger } from "../utils/logger";
import { systemStatuses } from "../api/project.controller";
import fs, { existsSync } from "fs";
const MODULE = "ollama.adapter.ts";

// Response schema unchanged
const responseSchema = { /* ... same as before ... */ };

export class OllamaAdapter implements LLMAdapter {
  private model: string = "gemma4:e4b"; // default model

  // constructor() {
  //   this.WarmUp();
  // }

  async WarmUp(input?: string): Promise<void> {
    logger.info(`[${MODULE}] Warming up the model...`);
    const respone = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: `Hello, This is a warm-up call, Do not reply.` }],
        stream: false,
        think: false,
        keep_alive: "50m",          // keep model alive after this request
      }),
    });

    const data = await respone.json();
    logger.info(`[${MODULE}] Model warmed up successfully.`);
    return data.message.content;

    // No specific warm-up logic needed for Ollama, but we can make a test call if desired
  }

  public async GetSummary(projectId: string, input: string): Promise<string> {
    const systemPrompt = `You are a helpful assistant that summarizes project documents context without missing any important information for the user.`
    try {
      console.time('Response Time for Summary');
      systemStatuses.set(projectId, { object: "", message: `UNDERSTANDING INTENT` });
      const response = await fetch('http://localhost:11434/api/chat', {
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

      });

      const data = await response.json();
      console.log("Summary response:", data);
      console.timeEnd('Response Time for Summary');
      systemStatuses.set(projectId, { object: "", message: `DONE` });
      return data.message.content || "UNKNOWN";
    } catch (err) {
      logger.error(`[${MODULE}] Failed to detect workflow type: ${err}`);
      return { actions: [] } as any; // Return empty actions on error, treating it as UNKNOWN intent
    }
  }

  public async GetIntent(projectId: string, input: string, historyText: string): Promise<string> {


    let intent = `
You are an **Intent Analyzer** – the interface between a user and an AI agent.  
Your ONLY job is to analyze the user’s latest input together with the last LLM response, determine the intent, and output a **strictly formatted JSON** object.

## INPUTS YOU RECEIVE
- \`historyText\` – The last response from the LLM to the user.
- \`input\` – The user’s current message.

## OUTPUT FORMAT (MANDATORY – NO EXCEPTIONS)

You MUST output **only** a valid JSON object. No text before, no text after.

{
    "actions": [
        {
            "type": "READ" | "WRITE" | "DELETE" | "SWITCH-AG" | "WORKFLOW",
            "target": "CLI:<path>" | "SYS:docs/<filename>.md" | "<agent-name>" | "NEXT-STEP" | "<StepId>",
            "content": "REQUIRED only for WRITE"
        }
    ]
}

If the intent cannot be determined or does not match any of the rules below, return:

{
    "actions": []
}

---

## INTENT CLASSIFICATION RULES

### 1. READ
**Trigger:** User asks to read content from a file or document.  
**Target:**  
- \`CLI:<path>\` → user/project files (e.g., \`CLI:src/main.py\`)  
- \`SYS:docs/<filename>.md\` → system documents (always inside \`docs/\` folder, \`.md\` extension)  

**Example input:** "Read the configuration file from config/app.json"  
**Output:**
{
    "actions": [
        {
            "type": "READ", 
            "target": "CLI:config/app.json"
        }
    ]
}

---

### 2. WRITE – General (requires triple backtick confirmation)

**Trigger conditions (ALL must be true):**

A) The user gives **explicit confirmation / approval** using one of these exact words/phrases:  
\`"save this file"\`, \`"write it"\`, \`"save it"\`, \`"confirm"\`, \`"yes"\`, \`"proceed"\`, \`"approved"\`, \`"looks good"\`, \`"go ahead"\`, \`"do it"\`, \`"apply"\`, \`"create it"\`, \`"update it"\`

AND

B) The last LLM response (\`historyText\`) **contains a final document inside triple backticks (\`\`\`) with a location or code block** that the user is approving.

**If both A and B are true:**  
- Extract the **exact content** from inside the triple backticks.  
- Determine target:  
  - If it’s a user‑facing file (code, config, script, etc.) → \`CLI:<path>\`  
  - If it’s a system document (PRD, analysis, planning, etc.) → \`SYS:docs/<filename>.md\`  
- Include the full content in the \`"content"\` field **exactly as shown** – no changes, no regeneration.

**If the user confirms but the last LLM response has no triple‑backtick code block** → do NOT write via this rule. Check the **STORY WRITE** rule below.

**Only write the content which is between the triple backticks.**
{
  "actions": [
    {
      "type": "WRITE",  
      "target": "CLI:src/app.py",
      "content": "The exact content from inside the triple backticks in the last LLM response, without any modifications."
    }  
  ]
}
**IMPORTANT – NO PREMATURE WRITES:**  
- Never write a file unless the user has **explicitly confirmed** after seeing the content.  
- Do not write based on assumptions or earlier messages.

---

### 3. STORY WRITE – Special rule for Scrum Master stories (no backticks required)

**Trigger conditions (ALL must be true):**

A) The user gives a **write/create command** using one of these exact words/phrases:  
\`"write these stories"\`, \`"write the story"\`, \`"save the story"\`, \`"create the story"\`, \`"save these stories"\`, \`"create these stories"\`, \`"write stories"\`, \`"create stories"\`, \`"write it"\`, \`"save it"\`, \`"create it"\`, \`"apply"\`, \`"do it"\`, \`"go ahead"\`, \`"proceed"\`, \`"yes"\`, \`"approved"\`

AND

B) The last LLM response (\`historyText\`) contains **one or more story documents** identifiable by these markers:

- A file‑path line matching:  
  \`**Story:** \`docs/stories/X.Y.some-name.md\`\`  
  OR \`### 📂 Story Document (FINAL VERSION)\` immediately followed by a story path  
  OR a line like \`Story: docs/stories/X.Y.some-name.md\`
- The story follows standard sections: \`# Story …\`, \`## Story\`, \`## Acceptance Criteria\`, \`## Tasks / Subtasks\`
- The story content is in plain Markdown (may or may not be inside triple backticks).

**If both A and B are true:**

- **Extract each story individually.** A new story starts at a \`# Story X.Y: …\` heading or after a clear file‑path marker for the next story (e.g., \`**Story:** \`docs/stories/…\`\`).
- For each story:
  - Capture the **file path** from the header.
  - Capture the **full story content** – from the \`# Story X.Y: …\` heading (or equivalent) down to the next \`***\` separator, the next story’s start, or the end of the message. Do **not** include the “Summary & Next Steps” or “Validation Report” sections that follow the story.
  - Target = \`SYS:docs/stories/<filename>.md\`
  - Content = the complete markdown of that one story, exactly as written.

- **Multiple stories:** If the response contains multiple stories, output **one WRITE action per story** in a single \`actions\` array.
- **Single story:** Output a single WRITE action for that story.
{
    "actions": [
        {
            "type": "WRITE", 
            "target": "SYS:docs/stories/1.1.Real-Time-Call-Stream-Ingestion-and-Transcription.md",
            "content": "# Story 1.1: Real-Time Call Stream Ingestion and Transcription Service..."
        },
        {
            "type": "WRITE", 
            "target": "SYS:docs/stories/1.2.analysis-intelligence.md",
            "content": "# Story 1.2: Analysis Engine for Structured Intelligence Extraction..."
        },
        {
            "type": "WRITE", 
            "target": "SYS:docs/stories/1.3.API-Gateway-Integration.md",
            "content": "# Story 1.3: API Gateway Integration..."
        }
    ]
}
**If no story file path is found → \`{"actions": []}\`.**

---

### 4. DELETE
**Trigger:** User asks to delete a file or document.  
**Target:** same as READ (\`CLI:\` or \`SYS:docs/\`)

**Example:** "Delete the old spec file"  
**Output:**
{
    "actions": [
        {
            "type": "DELETE", 
            "target": "SYS:docs/old_spec.md"
        }
    ]
}

---

### 5. WORKFLOW – STRICT TRIGGER

**Trigger (ALL must be true):**

1. The user’s input **contains one of these exact phrases** (case‑insensitive):
   - \`"next step"\`
   - \`"move to next step"\`
   - \`"go to next step"\`
   - \`"proceed to next step"\`
   - \`"step X"\` where X is a number (e.g., \`"step 3"\`)
   - \`"move to step X"\`
   - \`"go to step X"\`
   - \`"switch to step X"\`

2. The user is **not** simply selecting an option from a numbered list provided by the assistant (e.g., \`"1"\`, \`"2"\`, \`"3"\` by themselves).

3. The user is **not** giving a confirmation for a WRITE action (like \`"yes"\`, \`"looks good"\`, \`"proceed"\`).

**Target:**
- \`NEXT-STEP\` → only if the user says \`"next step"\` without a specific number.
- \`<StepId>\` → e.g., \`"3"\` if the user says \`"step 3"\` or \`"move to step 3"\`.

**EXAMPLES of valid WORKFLOW triggers:**
- \`"next step"\` → \`{"actions": [{"type": "WORKFLOW", "target": "NEXT-STEP"}]}\`
- \`"go to step 4"\` → \`{"actions": [{"type": "WORKFLOW", "target": "4"}]}\`
- \`"move to next step"\` → \`{"actions": [{"type": "WORKFLOW", "target": "NEXT-STEP"}]}\`

**EXAMPLES that MUST NOT trigger WORKFLOW:**
- \`"2"\` (only a number, without \`"step"\`)
- \`"Let's proceed"\` (no explicit \`"next step"\`)
- \`"What's next?"\` (question, not a command)
- \`"yes"\` or \`"ok"\` (these are confirmations, not workflow commands)
- \`"1"\` (selecting an option in a menu)

**If the input does not match the exact trigger patterns above → do NOT return WORKFLOW.** Return \`{"actions": []}\` unless another intent (READ, WRITE, etc.) matches.

---

### 6. SWITCH-AG
**Trigger:** User explicitly says to switch the current agent to a named agent.  
**Target:** the agent name (string, no prefix)  

**Example:** "Switch to the code reviewer agent"  
**Output:**
{
    "actions": [
        {
            "type": "SWITCH-AG", 
            "target": "code_reviewer"
        }
    ]
}

- Do not combine SWITCH-AG with any other action.

---

## ADDITIONAL STRICT RULES

- **No extra text** – Only the JSON object. No markdown formatting around it (no \`\`\`json).
- **Empty actions array** for any input that does not match READ, WRITE (general or story), DELETE, SWITCH-AG, or the strict WORKFLOW patterns.
- **Target paths** for \`SYS:\` must always be inside \`docs/\` and end with \`.md\`. If the user gives a different extension, correct it to \`.md\`.
- **Content for WRITE** must be a string. Preserve all whitespace and line breaks exactly as in the last LLM response.
- **Story content extraction boundaries**: Start from the \`# Story X.Y: …\` heading and include EVERYTHING until the next \`***\` separator, the next story’s start, or the end of the message. Do **not** include the “Summary & Next Steps” or “Validation Report” sections.
- **General WRITE extraction**: Only the content between the **first matching pair of triple backticks** that encloses the final document.
- **If uncertain → \`{"actions": []}\`.**
- **Evaluation order**: Check STORY WRITE first, then general WRITE (triple backtick), then WORKFLOW, then other intents.

---

## EXAMPLES OF CORRECT BEHAVIOR

| Last LLM Response | User Input | Correct Output |
|------------------|------------|----------------|
| \`"Here is the code:\n\`\`\`\nprint('hello')\n\`\`\`"\` | \`"save it"\` | \`{"actions": [{"type": "WRITE", "target": "CLI:script.py", "content": "print('hello')"}]}\` |
| \`"The analysis is ready."\` | \`"yes, write it"\` | \`{"actions": []}\` (no code block, no story markers) |
| \`"Final PRD:\n\`\`\`"SYS:docs/prd.md\n# Product Requirements Doc\n\nFull content here…\n\`\`\`"\` | \`"looks good, proceed"\` | \`{"actions": [{"type": "WRITE", "target": "SYS:docs/prd.md", "content": "# Product Requirements Doc\n\nFull content here…"}]}\` |
| \`"Architecture doc:\n\`\`\`"SYS:docs/architecture.md\n# Architecture\n\n…\n\`\`\`"\` | \`"go ahead"\` | \`{"actions": [{"type": "WRITE", "target": "SYS:docs/architecture.md", "content": "# Architecture\n\n…"}]}\` |
| SM provides story with \`docs/stories/1.1.xxx.md\` header + full markdown story | \`"write these stories in the system"\` | \`{"actions": [{"type": "WRITE", "target": "SYS:docs/stories/1.1.Real-Time-Call-Stream-Ingestion-and-Transcription.md", "content": "# Story 1.1: Real-Time…\n\n…full story…"}]}\` |
| SM provides story with file path + full markdown story | \`"create it"\` | \`{"actions": [{"type": "WRITE", "target": "SYS:docs/stories/1.1.xxx.md", "content": "…full story…"}]}\` |
| SM provides THREE stories (1.1, 1.2, 1.3) each with \`docs/stories/X.Y.name.md\` header + full markdown | \`"write stories"\` | \`{"actions": [{"type": "WRITE", "target": "SYS:docs/stories/1.1.xxx.md", "content": "# Story 1.1…"}, {"type": "WRITE", "target": "SYS:docs/stories/1.2.xxx.md", "content": "# Story 1.2…"}, {"type": "WRITE", "target": "SYS:docs/stories/1.3.xxx.md", "content": "# Story 1.3…"}]}\` |
| \`"…"\` | \`"read the file src/main.py"\` | \`{"actions": [{"type": "READ", "target": "CLI:src/main.py"}]}\` |
| Assistant asked "Type 1, 2, or 3" | \`"2"\` | \`{"actions": []}\` (number alone → no WORKFLOW) |
| Assistant asked "Type 1, 2, or 3" | \`"step 2"\` | \`{"actions": [{"type": "WORKFLOW", "target": "2"}]}\` |
| \`"…"\` | \`"switch to architect agent"\` | \`{"actions": [{"type": "SWITCH-AG", "target": "architect"}]}\` |
| \`"…"\` | \`"next step"\` | \`{"actions": [{"type": "WORKFLOW", "target": "NEXT-STEP"}]}\` |
| \`"…"\` | \`"hello, how are you?"\` | \`{"actions": []}\` |

---

## REMEMBER

- You are **only** an intent analyzer. Do not generate content, do not preview files, do not answer questions.
- If uncertain → return \`{"actions": []}\`.
- DO NOT ADD \`\`\`json MARKDOWN AROUND THE OUTPUT. ONLY THE RAW JSON OBJECT.
- Never write anything without confirmation **and** a detectable document in the last LLM response.
- **A single number (like "2") is NEVER a WORKFLOW command unless preceded by "step".**
- **Check STORY WRITE first, then general WRITE, then WORKFLOW, then other intents.**
- For MULTIPLE stories: output one WRITE action per story, all in the same \`actions\` array.
`
    const systemPrompt = intent + "\n\n" + "Last LLM response:\n" + historyText + "\n\n" + "Output the intent as a JSON object with the specified format and rules.";


    try {
      console.time('Response Time for Intent Detection');
      systemStatuses.set(projectId, { object: "", message: `UNDERSTANDING INTENT` });
      const response = await fetch('http://localhost:11434/api/chat', {
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
            "type": "object",
            "properties": {
              "actions": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": ["READ", "WRITE", "UPDATE", "DELETE", "SWITCH-AG", "WORKFLOW"]
                    },
                    "target": {
                      "type": "string",
                      "description": "CLI:<path>, SYS:<path>, <agent_name>, NEXT-STEP, or <StepId>"
                    },
                    "content": {
                      "type": "string",
                      "description": "Required only for WRITE and UPDATE actions"
                    }
                  },
                  "required": ["type", "target"],
                  "allOf": [
                    {
                      "if": {
                        "properties": { "type": { "enum": ["WRITE", "UPDATE"] } }
                      },
                      "then": {
                        "required": ["content"]
                      }
                    }
                  ]
                }
              }
            },
            "required": ["actions"]
          }
        }),

      });

      const data = await response.json();
      console.log("Raw intent detection response:", data);
      console.timeEnd('Response Time for Intent Detection');
      systemStatuses.set(projectId, { object: "", message: `DONE` });
      return data.message.content || "UNKNOWN";
    } catch (err) {
      logger.error(`[${MODULE}] Failed to detect workflow type: ${err}`);
      return { actions: [] } as any; // Return empty actions on error, treating it as UNKNOWN intent
    }
  }


  async GetWorkFlowType(projectId: string, input: string): Promise<any> {
    let thinking: string | boolean = true;
    if (this.model === "gpt-oss:20b") thinking = "low";

    logger.info(`[${MODULE}] Fetching project workflow type.`);

    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: `Read this project context and return the type,\n\n${input}\n\nIf greenfield then STRICTLY return "greenfield.yaml" , if brownfield then STRICTLY return "brownfield.yaml"` }],
        stream: false,
        think: thinking,
        keep_alive: "30m",          // keep model alive after this request
      }),
    });

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    return data.message.content;
  }

  async executeAction(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: { role: string, content: string }[] }): Promise<any> {
    let thinking: string | boolean = true;
    if (this.model === "gpt-oss:20b") thinking = "medium";

    logger.info(`[${MODULE}] Generating non‑streaming response.`);

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
        format: responseSchema,
        keep_alive: "30m",
      }),
    });

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    return data.message.content;
  }

  async *generate(projectId: string, params: { systemPrompt: string; userPrompt: string, dynamicContext?: string, history?: { role: string, content: string }[] }): AsyncGenerator<{ res: string | null; tools: string | null; think?: string | null; done: boolean }> {
    const useChat = true; // keep your existing logic
    const endpoint = useChat ? 'http://localhost:11434/api/chat' : 'http://localhost:11434/api/generate';

    let thinking: string | boolean = true;
    if (this.model === "gpt-oss:20b") thinking = "medium";

    logger.info(`[${MODULE}] Connecting with model: ${this.model}`);

    let requestBody: any = {
      model: this.model,
      stream: true,
      keep_alive: "50m",           // keep model loaded for 30 minutes
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

    // write the full input to the LLM in the 'src/logs/FullInput.md' for debugging purposes
    const fullInputLogPath = `logs/FullInput.md`;
    const fullInputContent = `## params.systemPrompt:\n\n${params.systemPrompt}\n\n## params.userPrompt:\n\n${params.userPrompt}`;
    fs.writeFile(fullInputLogPath, fullInputContent, (err) => {
      if (err) logger.error(`[${MODULE}] Failed to write full input log: ${err}`);
    });
    logger.info(`[${MODULE}] Full input logged to ${fullInputLogPath}`);

    console.time('Response Time');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    logger.info(`[${MODULE}] Streaming response...`);
    console.timeEnd('Response Time');
    console.time('thinking Time');

    logger.info(`[${MODULE}] ${endpoint}`);


    let thinkingLogged = false;
    while (true) {
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
                console.timeEnd('thinking Time');
                thinkingLogged = true;
              }
              systemStatuses.set(projectId, { object: "LLM", message: 'RESPONDING' });
            }
          }

          yield { res: content, tools: tool, think: thinkContent, done: isDone };
          if (isDone) return;
        } catch (err) {
          logger.error(`[${MODULE}] Failed to parse chunk: ${line}`, err);
        }
      }
    }
    yield { res: null, tools: null, done: true };
  }
}