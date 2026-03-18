import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { logger } from "../utils/logger";
import { ProjectState } from "./project-state/project-state.model";

const MODULE = "workflow-engine.ts";

export interface WorkflowStep {
  id: number;
  name: string;
  agent: string;
  requires?: string[];
  creates?: string[];
  updates?: string[];
  template?: string;
  condition?: string;
  next?: number | NextLogic;
  after?: string;
  notes?: string;
}

export interface NextLogic {
  default: number;
  conditions?: Array<{
    if: string;
    then: number;
  }>;
}

export interface WorkflowDefinition {
  type: string;
  version: number;
  variables?: Record<string, any>;
  steps: WorkflowStep[];
}

export class WorkflowEngine {
  static loadWorkflow(fileName: string): WorkflowDefinition {
    const workflowPath = path.join(__dirname, "..", "workflows", fileName);
    logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
    const fileContent = fs.readFileSync(workflowPath, "utf-8");
    const workflow = yaml.load(fileContent) as WorkflowDefinition;
    if (!workflow || !workflow.type || !workflow.version || !workflow.steps) {
      logger.error(`[${MODULE}] Invalid workflow structure in file: ${fileName}`);
      throw new Error(`Invalid workflow structure in file: ${fileName}`);
    }
    logger.debug(`[${MODULE}] Workflow loaded successfully (${workflow.steps.length} steps)`);
    return workflow;
  }

  static getStepById(workflow: WorkflowDefinition, stepId: number): WorkflowStep {
    logger.debug(`[${MODULE}] Looking up step ${stepId}`);
    const step = workflow.steps.find(s => s.id === stepId);
    if (!step) {
      logger.error(`[${MODULE}] Step ${stepId} not found in workflow`);
      throw new Error(`Step ${stepId} not found in workflow`);
    }
    return step;
  }

  static resolvePlaceholders(str: string, state: ProjectState): string {
    logger.debug(`[${MODULE}] Resolving placeholders in: "${str}"`);
    const resolved = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key === "storyIndex") {
        const val = String(state.dynamicContext.currentStoryIndex);
        logger.debug(`[${MODULE}] Replaced {{storyIndex}} with ${val}`);
        return val;
      }
      logger.warn(`[${MODULE}] Unknown placeholder {{${key}}}, leaving unchanged`);
      return `{{${key}}}`;
    });
    logger.debug(`[${MODULE}] Resolved string: "${resolved}"`);
    return resolved;
  }

  static evaluateCondition(expr: string, state: ProjectState): boolean {
    const trimmed = expr.trim();
    logger.debug(`[${MODULE}] Evaluating condition: "${trimmed}"`);

    if (trimmed.includes("<")) {
      const [left, right] = trimmed.split("<").map(s => s.trim());
      const leftVal = this.resolveValue(left, state);
      const rightVal = this.resolveValue(right, state);
      const result = leftVal < rightVal;
      logger.debug(`[${MODULE}] ${left} (${leftVal}) < ${right} (${rightVal}) = ${result}`);
      return result;
    }
    if (trimmed.includes(">")) {
      const [left, right] = trimmed.split(">").map(s => s.trim());
      const leftVal = this.resolveValue(left, state);
      const rightVal = this.resolveValue(right, state);
      const result = leftVal > rightVal;
      logger.debug(`[${MODULE}] ${left} (${leftVal}) > ${right} (${rightVal}) = ${result}`);
      return result;
    }
    if (trimmed.includes("==")) {
      const [left, right] = trimmed.split("==").map(s => s.trim());
      const leftVal = this.resolveValue(left, state);
      const rightVal = this.resolveValue(right, state);
      const result = leftVal == rightVal;
      logger.debug(`[${MODULE}] ${left} (${leftVal}) == ${right} (${rightVal}) = ${result}`);
      return result;
    }
    if (trimmed.startsWith("!")) {
      const subExpr = trimmed.substring(1).trim();
      const result = !this.evaluateCondition(subExpr, state);
      logger.debug(`[${MODULE}] NOT (${subExpr}) = ${result}`);
      return result;
    }

    // Simple boolean variable
    const val = this.resolveValue(trimmed, state);
    const result = Boolean(val);
    logger.debug(`[${MODULE}] Boolean(${trimmed}) = ${result} (value: ${val})`);
    return result;
  }

  private static resolveValue(token: string, state: ProjectState): any {
    logger.debug(`[${MODULE}] Resolving value for token: "${token}"`);
    // Handle literals
    if (token.match(/^[0-9]+$/)) return parseInt(token, 10);
    if (token === "true") return true;
    if (token === "false") return false;

    // Handle state variables
    if (token.startsWith("stories.")) {
      const parts = token.split(".");
      if (parts[1] === "length") {
        const len = state.dynamicContext.stories?.length || 0;
        logger.debug(`[${MODULE}] stories.length = ${len}`);
        return len;
      }
    }
    if (token in state.dynamicContext) {
      const val = (state.dynamicContext as any)[token];
      logger.debug(`[${MODULE}] dynamicContext.${token} = ${val}`);
      return val;
    }
    logger.warn(`[${MODULE}] Token "${token}" not recognized, returning undefined`);
    return undefined;
  }

  static getNextStepId(
    currentStep: WorkflowStep,
    state: ProjectState
  ): number | null {
    logger.debug(`[${MODULE}] Determining next step for step ${currentStep.id}`);
    if (!currentStep.next) {
      logger.debug(`[${MODULE}] No next field defined, workflow ends.`);
      return null;
    }
    if (typeof currentStep.next === "number") {
      logger.debug(`[${MODULE}] Next step is fixed: ${currentStep.next}`);
      return currentStep.next;
    }
    const nextLogic = currentStep.next as NextLogic;
    if (nextLogic.conditions) {
      for (const cond of nextLogic.conditions) {
        const condResult = this.evaluateCondition(cond.if, state);
        logger.debug(`[${MODULE}] Condition "${cond.if}" evaluated to ${condResult}`);
        if (condResult) {
          logger.debug(`[${MODULE}] Taking conditional next step: ${cond.then}`);
          return cond.then;
        }
      }
    }
    logger.debug(`[${MODULE}] Using default next step: ${nextLogic.default}`);
    return nextLogic.default;
  }

  static findInitialStep(workflow: WorkflowDefinition, state: ProjectState): number | null {
    logger.debug(`[${MODULE}] Searching for initial executable step`);
    for (const step of workflow.steps) {
      if (state.completedSteps.includes(step.id)) {
        logger.debug(`[${MODULE}] Step ${step.id} already completed, skipping`);
        continue;
      }
      if (this.areRequirementsSatisfied(step, state)) {
        logger.info(`[${MODULE}] Initial step found: ${step.id} (${step.name})`);
        return step.id;
      }
    }
    logger.warn(`[${MODULE}] No executable step found`);
    return null;
  }

  private static areRequirementsSatisfied(step: WorkflowStep, state: ProjectState): boolean {
    logger.debug(`[${MODULE}] Checking requirements for step ${step.id}`);
    if (!step.requires || step.requires.length === 0) {
      logger.debug(`[${MODULE}] No requirements, satisfied`);
      return true;
    }
    for (let req of step.requires) {
      const resolvedReq = this.resolvePlaceholders(req, state);
      const doc = state.documents[resolvedReq];
      if (!doc || doc.status !== "completed") {
        logger.debug(`[${MODULE}] Requirement not met: ${resolvedReq} (status: ${doc?.status || 'missing'})`);
        return false;
      }
    }
    if (step.condition) {
      const condMet = this.evaluateCondition(step.condition, state);
      logger.debug(`[${MODULE}] Condition "${step.condition}" met: ${condMet}`);
      if (!condMet) return false;
    }
    logger.debug(`[${MODULE}] All requirements satisfied`);
    return true;
  }
}