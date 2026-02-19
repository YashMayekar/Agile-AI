/**
 * Workflow Engine
 * Responsible for:
 * - Loading YAML workflow
 * - Validating structure
 * - Determining next step
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { logEvent, logger } from "../utils/logger";
import { log } from "console";

export interface WorkflowStep {
  id: Number;
  name: string;
  agent: string;
  requires?: string[];
  creates?: string[];
  optional?: string[];
  next?: Number;
}

export interface WorkflowDefinition {
  type: string;
  version: number;
  sequence: WorkflowStep[];
}

export class WorkflowEngine {

  static loadWorkflow(fileName: string): WorkflowDefinition {
    const workflowPath = path.join(__dirname, "..", "workflows", fileName);
    const fileContent = fs.readFileSync(workflowPath, "utf-8");
    const workflow = yaml.load(fileContent) as WorkflowDefinition;
    // const workflow = yaml.load(fileContent) as WorkflowDefinition;
    if (!workflow || !workflow.type || !workflow.version || !workflow.sequence) {
      logger.error(`Invalid workflow structure in file: ${fileName}`);
      throw new Error(`Invalid workflow structure in file: ${fileName}`);
    }
    

    return workflow;
  }

  /**
   * Returns current step object
   */
  static getCurrentStep(workflow: WorkflowDefinition, stepId: Number): WorkflowStep {
    const step = workflow.sequence.find(s => s.id === stepId);
    logger.debug(`stepid = ${stepId} in Worfloe sequence: ${JSON.stringify(workflow.sequence[0])}`);

    if (!step) {
      throw new Error(`Step ${stepId} not found in workflow`);
    }

    return step;
  }

  /**
   * Determines next step ID
   */
  static getNextStep(currentStep: WorkflowStep): Number | null {
    return currentStep.next || null;
  }

  /**
   * Checks if required documents exist
   */
  static validateRequirements(
    requiredDocs: string[] | undefined,
    existingDocs: Record<string, any>
  ) {
    if (!requiredDocs) return true;

    for (const doc of requiredDocs) {
      if (!existingDocs[doc]) {
        throw new Error(`Required document missing: ${doc}`);
      }
    }

    return true;
  }
}
