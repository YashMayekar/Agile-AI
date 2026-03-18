Excellent — this is the **intelligence loop** of your system.

Below is a **deep technical breakdown of each layer**, specifically tailored to your existing backend structure.

---

# 🧩 1️⃣ User Input

### What it is

Any new event entering the system:

* User message
* File upload
* Manual override
* Agent output
* QA result
* Validation failure

### Responsibilities

* Normalize input into a structured event.
* Attach metadata (projectId, timestamp, user intent).
* Classify intent:

  * New instruction
  * Clarification
  * Override
  * Artifact upload
  * Retry request
  * Skip request

### Output

```ts
interface SystemEvent {
  type: "user_message" | "artifact_uploaded" | "override" | "agent_result"
  intent: string
  payload: any
  projectId: string
}
```

---

# 🎛 2️⃣ Orchestrator

This becomes the **central control loop**, not a step runner.

### Responsibilities

1. Load project state
2. Apply incoming event
3. Trigger situation evaluation
4. Ask goal engine what is incomplete
5. Ask planner what to do
6. Execute chosen step
7. Run reflection
8. Persist state
9. Repeat until stable

### It should NOT:

* Decide next step directly
* Contain business logic
* Contain workflow logic

It coordinates only.

---

# 🧠 3️⃣ Situation Evaluator

This is your awareness layer.

### Purpose

Transform raw project state into high-level situational flags.

### It analyzes:

* Existing artifacts
* Validation results
* User overrides
* Step history
* Incomplete dependencies
* QA results
* Document inconsistencies
* Missing required files

### Produces:

```ts
interface SituationState {
  flags: string[]
  missingArtifacts: string[]
  inconsistencies: string[]
  blockedSteps: string[]
  projectType: "greenfield" | "brownfield"
}
```

### Example Flags

* "user_provided_prd"
* "architecture_conflict"
* "frontend_not_required"
* "qa_failed"
* "missing_required_artifact"
* "document_inconsistent"

This is what makes the system context-aware.

---

# 🎯 4️⃣ Goal Engine

This layer answers:

> What are we trying to achieve right now?

Instead of thinking in steps, think in goals.

### Examples of Goals

* `project_brief_created`
* `prd_validated`
* `architecture_complete`
* `stories_approved`
* `epic_complete`
* `project_complete`

### Responsibilities

1. Evaluate which goals are satisfied.
2. Determine highest-priority unmet goal.
3. Map goal → required artifacts.

Example:

```ts
Goal: prd_validated

Satisfied when:
- prd.md exists
- po_review_passed = true
```

### Output

```ts
interface GoalStatus {
  activeGoal: string
  unmetConditions: string[]
}
```

This shifts system thinking from:

> “What’s next?”

to:

> “What’s missing?”

---

# 🧭 5️⃣ Adaptive Planner

This is the intelligence core.

It answers:

> Given current situation + active goal, what should we do?

### Inputs:

* Situation flags
* Active goal
* Workflow graph
* Step metadata
* User constraints

### It evaluates:

1. Which steps can produce missing artifacts?
2. Which steps are allowed?
3. Which steps are blocked?
4. Which steps are skippable?
5. Which steps conflict with constraints?

### Example Decision:

```ts
{
  stepId: "03",
  action: "skip",
  reason: "frontend_not_required"
}
```

or

```ts
{
  stepId: "05",
  action: "execute",
  reason: "architecture_suggests_prd_changes"
}
```

### Core Planner Logic

```
1. Identify unmet goal
2. Find steps that produce required artifacts
3. Filter by:
   - Requires satisfied
   - Not completed
   - Not skipped permanently
   - Conditions true
4. Rank by:
   - Mandatory > optional
   - Priority score
   - Dependency weight
5. Choose best candidate
```

---

# ⚙️ 6️⃣ Workflow Engine (Execution Layer)

This is your current execution layer.

It should:

* Execute exactly what planner selected
* Run the appropriate agent
* Validate agent output
* Save artifacts
* Mark step as completed

It should NOT:

* Decide next step
* Check goal satisfaction
* Handle situational logic

It becomes a pure executor.

---

# 🔍 7️⃣ Reflection Engine

This is your self-correction layer.

After execution:

It asks:

* Did the artifact pass schema validation?
* Did it introduce inconsistencies?
* Did it break another document?
* Did QA fail?
* Should we re-run something?

### Produces:

```ts
interface ReflectionResult {
  isConsistent: boolean
  issues: string[]
  recommendedActions: string[]
}
```

This enables:

* Automatic rework
* PRD update after architecture
* Re-run validation
* Loop back intelligently

Without reflection, system becomes fragile.

---

# 💾 8️⃣ State Update

This is where everything gets persisted.

State must include:

```ts
interface ProjectState {
  artifacts: Record<string, ArtifactStatus>
  completedSteps: string[]
  skippedSteps: string[]
  stepHistory: StepExecution[]
  situationFlags: string[]
  activeGoal: string
  constraints: ProjectConstraints
  reflectionReports: ReflectionResult[]
}
```

Key addition:

* WHY decisions were made
* Not just WHAT happened

---

# 🔁 9️⃣ Loop

The system loops until:

* Active goal satisfied
* No executable steps available
* User interruption
* Project complete

This makes your system:

> Reactive + deliberative + adaptive.

---

# 🧠 What This Achieves

| Old System              | New System            |
| ----------------------- | --------------------- |
| Linear                  | Goal-driven           |
| Static                  | Adaptive              |
| Sequence-based          | Policy-based          |
| Fragile to user changes | Interrupt-friendly    |
| Single path             | Multi-path            |
| No reasoning            | Multi-layer reasoning |

---

# 🏗 Where It Fits in Your Current Structure

You already have:

```
workflow-engine.ts
orchestrator.ts
context-builder.ts
memory-summarizer.ts
state-manager.ts
```

You need to add:

```
/core/planning/adaptive-planner.ts
/core/goals/goal-engine.ts
/core/situation/situation-evaluator.ts
/core/reflection/reflection-engine.ts
```

---

# 🔥 Final Mental Model

Your system becomes:

> A Goal-Oriented Autonomous Project Manager
> with dynamic workflow execution.

---

If you'd like next, I can:

* Design the **exact TypeScript interfaces**
* Provide a **step-by-step planner algorithm**
* Or redesign your `workflow.schema.json` into adaptive format
* Or show how to convert your existing `greenfield.yaml` into graph + policy form
