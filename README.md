# 🚀 Agile-AI  
### AI-Driven Orchestration System for Agile Software Development

Agile-AI is a **state-aware, multi-agent orchestration system** designed to automate the Agile software development lifecycle using **controlled LLM execution** instead of free-form prompting.

It enables structured, iterative, and context-aware development by maintaining **project-level memory**, orchestrating **specialized agents**, and converting LLM outputs into **executable system actions**.

---

## ✨ Key Features

- 🧠 **Project-Level Context Awareness**  
  Maintains persistent shared context across all agents and workflow stages.

- 🤖 **Multi-Agent Architecture**  
  Specialized agents (PM, Analyst, Developer, QA, etc.) operate with defined roles.

- 🔄 **Workflow-Driven Execution**  
  YAML-based workflows (greenfield / brownfield) control system behavior.

- 🧩 **Structured LLM Outputs → Actions**  
  Converts model responses into executable actions (READ, WRITE, UPDATE, DELETE).

- 📦 **Context & Memory Optimization**  
  Combines recent conversations + summarized history to stay within LLM limits.

- ⚡ **Streaming Responses**  
  Real-time token streaming for better responsiveness.

- 🔓 **Fully Open-Source & Local LLM Compatible**  
  Works with local models via Ollama — no paid APIs required.

---

## 🏗️ Architecture Overview
<img width="3003" height="1409" alt="Agile-System-Architecture" src="https://github.com/user-attachments/assets/4b232834-f4cb-4027-9fa1-562121eeac0f" />


### Core Layers

1. **Orchestration Layer**
   - Controls workflow steps and agent routing
   - Maintains execution state

2. **Context & Memory Layer**
   - Builds structured prompts
   - Optimizes token usage via summarization

3. **Agent Layer**
   - Role-based agents with prompt templates

4. **Execution Layer**
   - Converts LLM outputs → structured actions → real operations

---

## 📂 Project Structure

```

├── agents/            # Agent definitions + prompt templates
├── api/               # API controllers
├── core/              # Core orchestration logic
│   ├── action-engine/ # Action execution system
│   └── project-state/ # State persistence
├── llm/               # Model adapters (Ollama, Gemini)
├── schemas/           # JSON schemas for validation
├── templates/         # Document templates
├── utils/             # Logging, file system, helpers
├── workflows/         # Workflow definitions (YAML)
├── app.ts             # App setup
└── server.ts          # Entry point

```

---

## 🧠 Core Concepts

### 1. Orchestrator
Central engine that:
- Tracks workflow state
- Selects agent
- Builds context
- Streams LLM responses
- Executes actions

---

### 2. Context Builder
Constructs structured prompts using:
- Project state
- Workflow step
- Relevant documents
- Conversation memory

---

### 3. Memory Manager
- Stores conversations
- Summarizes older history
- Ensures token-efficient context

---

### 4. Intent Analyzer
Separates:
- **Reasoning (LLM response)**  
from  
- **Execution (structured actions)**  

Improves reliability and reduces hallucination.

---

### 5. Action Engine

Supported actions:
- `READ`
- `WRITE`
- `UPDATE`
- `DELETE`
- `WORKFLOW SWITCH`

All actions are:
- validated  
- parsed  
- safely executed  

---

### 6. Workflow Engine

Defined using YAML:
- `greenfield.yaml` → new project flow  
- `brownfield.yaml` → existing project analysis  

Controls:
- agent transitions  
- required documents  
- execution order  

---

## 🔌 Supported LLMs

This system is **model-agnostic**.

Tested with:
- Gemma
- Qwen
- DeepSeek
- Mistral variants
- GPT-OSS (local)
- Nemotron / Granite

Supports:
- Local models via **Ollama**
- External models via adapters (e.g., Gemini)

---
## 🖥️ Demo / Preview
### System Document Creation
<img width="1600" height="850" alt="image" src="https://github.com/user-attachments/assets/33359488-415e-49ad-93fa-7ac082a294d2" />

### User Side Functions
<img width="1920" height="1020" alt="image" src="https://github.com/user-attachments/assets/3c45eb31-dbfd-4bf6-b6ff-a75b89c5254f" />


## ⚙️ How It Works (Flow)

1. User provides input  
2. Orchestrator loads project state  
3. Context Builder prepares structured prompt  
4. Memory Manager injects relevant history  
5. Intent Analyzer extracts structured actions
6. LLM generates response  
7. Action Engine executes operations  
9. Memory is updated  
10. Workflow progresses  

---

## 🧪 Evaluation Approach

The system was iteratively optimized using:

- Manual evaluation of generated documents  
- Validation of structured action outputs  
- Response latency benchmarking  

These informed:
- model selection  
- prompt refinement  
- architecture improvements  

---

## ⚠️ Known Constraints

- Performance depends on local hardware (for local LLMs)
- Requires careful prompt tuning for best results
- No formal automated evaluation pipeline (yet)

---

## 🔮 Future Improvements

- Dynamic model routing (local ↔ hosted fallback)
- Automated evaluation metrics & benchmarking
- Improved schema validation & guardrails
- Lightweight fine-tuned models for intent detection

---

## 🌍 Why This Matters

This system is designed to run on **free and open-source models**, making it:

- Accessible  
- Cost-effective  
- Deployable in low-resource environments  

It aligns with the vision of making **AI-assisted development and learning more equitable and scalable**.

---

## 🧑‍💻 Author

**Yash Mayekar**  
📧 yashvmayekar21@gmail.com  
🔗 https://github.com/YashMayekar  

---
