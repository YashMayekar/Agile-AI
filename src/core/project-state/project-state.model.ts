/**
 * Represents a file node in the project tree.
 */
export interface FileNode {
  file: string;
}

export interface History {
  History: ProjectHistoryEntry[];
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

export interface ChatHistoryEntry {
  user: string;
  ag_res: string;
  ag_type: string;
  timestamp: number; // actual timestamp (e.g., Date.now())
}


export interface ProjectState {
  projectId: string;
  mode: "greenfield" | "brownfield" | null;
  phase: "planning" | "designing" | "development" | "testing";
  currentStepId: number | string | null;   // current step (or instance) to execute
  currentAgent: string;

  systemStatus: string;

  workflowFile: string;

  documents: Record<string, ProjectDocument>;
  dialogueHistory?: Array<{ role: "user" | "assistant"; content: string }>;

  // One‑time completed steps (steps that will never be repeated)
  completedSteps: (number | string)[];


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