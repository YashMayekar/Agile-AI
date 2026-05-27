"use strict";
// /**
//  * Brownfield Project Analyzer
//  *
//  * - Scans project structure
//  * - Detects tech stack
//  * - Summarizes project
//  */
// import fs from "fs";
// import path from "path";
// import { OllamaAdapter } from "../llm/ollama.adapter";
// export class BrownfieldAnalyzer {
//   static async analyze(projectPath: string) {
//     const files = fs.readdirSync(projectPath);
//     const summaryInput = `
// Project files:
// ${files.join("\n")}
// Analyze:
// - Likely tech stack
// - Framework
// - Architecture style
// - Project type
// `;
//     const llm = new OllamaAdapter();
//     const result = await llm.generate({
//       systemPrompt: "You are a senior software architect.",
//       userPrompt: summaryInput
//     });
//     return result.raw;
//   }
// }
