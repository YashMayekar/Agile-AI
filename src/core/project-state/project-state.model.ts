/**
 * Represents a file node in the project tree.
 */
export interface FileNode {
  file: string;
}

/**
 * Represents a directory node in the project tree.
 */
export interface DirectoryNode {
  directory: string;
  children: FileTreeNode[];
}

/**
 * Union type for file system tree nodes.
 */
export type FileTreeNode = FileNode | DirectoryNode;

/**
 * Type guard to check if a node is a directory.
 */
export function isDirectory(node: FileTreeNode): node is DirectoryNode {
  return (node as DirectoryNode).children !== undefined;
}

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
  stepId: number | string;        // can be compound like "8-1"
  agent: string;
  timestamp: string;
  summary: string;
}

export interface ProjectState {
  projectId: string;
  mode: "greenfield" | "brownfield";
  phase: "planning" | "implementation";
  currentStepId: number | string | null;   // current step (or instance) to execute
  workflowFile: string;

  documents: Record<string, ProjectDocument>;

  // One‑time completed steps (steps that will never be repeated)
  completedSteps: (number | string)[];

  history: ProjectHistoryEntry[];

  // Persistent memory for the project (used by agents)
  contextMemory: {
    summary: string;
    decisions: string[];
    architectureNotes: string[];
  };

  // Runtime variables used by the workflow
  dynamicContext: {
    stories?: string[];             // list of story identifiers after sharding
    currentStoryIndex: number;       // 0‑based index of the story being worked on
    qaLeftUnchecked?: boolean;       // flag for QA feedback loop
    fileTree?: FileTreeNode;         // root of the project's directory tree (sent from VS Code)
    // any other variables as needed
  };
}