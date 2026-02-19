/**
 * Defines TypeScript interface for Project State.
 * This structure mirrors project-state.schema.json
 */

export interface ProjectDocument {
  status: "pending" | "completed";
  version: number;
  updatedAt: string;
}

export interface ProjectHistoryEntry {
  stepId: Number;
  agent: string;
  timestamp: string;
  summary: string;
}

export interface ProjectState {
  projectId: string;
  mode: "greenfield" | "brownfield";
  phase: "planning" | "implementation";
  currentStepId: Number;
  workflowFile: string;

  documents: Record<string, ProjectDocument>;

  completedSteps: Number[];
  pendingSteps: Number[];
  blockedSteps: Number[];

  history: ProjectHistoryEntry[];

  contextMemory: {
    summary: string;
    decisions: string[];
    architectureNotes: string[];
  };
}
