/**
 * Attempts to repair invalid JSON using LLM.
 * Sends corrective prompt.
 */

import { OllamaAdapter } from "../llm/ollama.adapter";

export async function repairJSON(invalidOutput: string) {

  const llm = new OllamaAdapter();

  const repairPrompt = `
The following output is invalid JSON.
Fix it and return ONLY valid JSON.

OUTPUT:
${invalidOutput}
`;

  const response = await llm.generate({
    systemPrompt: "You are a JSON repair assistant.",
    userPrompt: repairPrompt
  });

  return response.raw;
}
