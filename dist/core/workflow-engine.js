"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkflowEngine = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const logger_1 = require("../utils/logger");
const MODULE = "workflow-engine.ts";
class WorkflowEngine {
    static loadWorkflow(fileName) {
        const workflowPath = path_1.default.join(__dirname, "..", "workflows", fileName);
        logger_1.logger.debug(`[${MODULE}] Loading workflow from ${workflowPath}`);
        const content = fs_1.default.readFileSync(workflowPath, "utf-8");
        const workflow = js_yaml_1.default.load(content);
        if (!workflow || !workflow.type || !workflow.steps) {
            logger_1.logger.error(`[${MODULE}] Invalid workflow structure in file: ${fileName}`);
            throw new Error(`Invalid workflow structure in file: ${fileName}`);
        }
        this.workflow = workflow;
        logger_1.logger.debug(`[${MODULE}] Workflow loaded successfully (${workflow.steps.length} steps)`);
        return workflow;
    }
    static getStepById(stepId) {
        logger_1.logger.debug(`[${MODULE}] Looking up step ${stepId}`);
        if (!this.workflow) {
            logger_1.logger.error(`[${MODULE}] No Workflow foun to get the current step: ${stepId}`);
            throw new Error(`No Workflow foun to get the current step: ${stepId}`);
        }
        const step = this.workflow.steps.find(s => s.id === stepId);
        if (!step) {
            logger_1.logger.error(`[${MODULE}] Step ${stepId} not found in workflow`);
            throw new Error(`Step ${stepId} not found in workflow`);
        }
        return step;
    }
    static getNextSteps(stepId) {
        logger_1.logger.info(`Building steps from step ID: ${stepId}`);
        const steps = [];
        // steps.push(this.getStepById(stepId))
        const next_steps = this.getStepById(stepId).next;
        if (Array.isArray(next_steps)) {
            for (const stepId of next_steps) {
                const step = this.getStepById(stepId);
                steps.push(step);
            }
        }
        return steps;
    }
    static getRequiredFiles(stepId) {
        const step = this.getStepById(stepId);
        return step.requires || [];
    }
    static resolvePlaceholders(str, state) {
        logger_1.logger.debug(`[${MODULE}] Resolving placeholders in: "${str}"`);
        const resolved = str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
            if (key === "storyIndex") {
                const val = String(state.dynamicContext.currentStoryIndex);
                logger_1.logger.debug(`[${MODULE}] Replaced {{storyIndex}} with ${val}`);
                return val;
            }
            logger_1.logger.warn(`[${MODULE}] Unknown placeholder {{${key}}}, leaving unchanged`);
            return `{{${key}}}`;
        });
        logger_1.logger.debug(`[${MODULE}] Resolved string: "${resolved}"`);
        return resolved;
    }
    static evaluateCondition(expr, state) {
        const trimmed = expr.trim();
        logger_1.logger.debug(`[${MODULE}] Evaluating condition: "${trimmed}"`);
        if (trimmed.includes("<")) {
            const [left, right] = trimmed.split("<").map(s => s.trim());
            const leftVal = this.resolveValue(left, state);
            const rightVal = this.resolveValue(right, state);
            const result = leftVal < rightVal;
            logger_1.logger.debug(`[${MODULE}] ${left} (${leftVal}) < ${right} (${rightVal}) = ${result}`);
            return result;
        }
        if (trimmed.includes(">")) {
            const [left, right] = trimmed.split(">").map(s => s.trim());
            const leftVal = this.resolveValue(left, state);
            const rightVal = this.resolveValue(right, state);
            const result = leftVal > rightVal;
            logger_1.logger.debug(`[${MODULE}] ${left} (${leftVal}) > ${right} (${rightVal}) = ${result}`);
            return result;
        }
        if (trimmed.includes("==")) {
            const [left, right] = trimmed.split("==").map(s => s.trim());
            const leftVal = this.resolveValue(left, state);
            const rightVal = this.resolveValue(right, state);
            const result = leftVal == rightVal;
            logger_1.logger.debug(`[${MODULE}] ${left} (${leftVal}) == ${right} (${rightVal}) = ${result}`);
            return result;
        }
        if (trimmed.startsWith("!")) {
            const subExpr = trimmed.substring(1).trim();
            const result = !this.evaluateCondition(subExpr, state);
            logger_1.logger.debug(`[${MODULE}] NOT (${subExpr}) = ${result}`);
            return result;
        }
        // Simple boolean variable
        const val = this.resolveValue(trimmed, state);
        const result = Boolean(val);
        logger_1.logger.debug(`[${MODULE}] Boolean(${trimmed}) = ${result} (value: ${val})`);
        return result;
    }
    static resolveValue(token, state) {
        logger_1.logger.debug(`[${MODULE}] Resolving value for token: "${token}"`);
        // Handle literals
        if (token.match(/^[0-9]+$/))
            return parseInt(token, 10);
        if (token === "true")
            return true;
        if (token === "false")
            return false;
        // Handle state variables
        if (token.startsWith("stories.")) {
            const parts = token.split(".");
            if (parts[1] === "length") {
                const len = state.dynamicContext.stories?.length || 0;
                logger_1.logger.debug(`[${MODULE}] stories.length = ${len}`);
                return len;
            }
        }
        if (token in state.dynamicContext) {
            const val = state.dynamicContext[token];
            logger_1.logger.debug(`[${MODULE}] dynamicContext.${token} = ${val}`);
            return val;
        }
        logger_1.logger.warn(`[${MODULE}] Token "${token}" not recognized, returning undefined`);
        return undefined;
    }
}
exports.WorkflowEngine = WorkflowEngine;
