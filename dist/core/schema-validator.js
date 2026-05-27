"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchemaValidator = void 0;
const ajv_1 = __importDefault(require("ajv"));
const ajv_formats_1 = __importDefault(require("ajv-formats"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../utils/logger");
class SchemaValidator {
    static validateIntentResponse(raw) {
        // 1. Extract JSON block (first {...} found)
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match)
            return false;
        let parsed;
        try {
            parsed = JSON.parse(match[0]);
        }
        catch {
            return false;
        }
        // 2. Validate root
        if (!Array.isArray(parsed.actions))
            return false;
        // 3. Validate actions
        const validTypes = [
            "READ", "WRITE", "UPDATE", "DELETE", "SWITCH-AG", "WORKFLOW"
        ];
        if (parsed.actions.length > 0) {
            for (const action of parsed.actions) {
                if (!validTypes.includes(action.type))
                    return false;
                if (typeof action.target !== "string")
                    return false;
                // content required only for WRITE and UPDATE
                if ((action.type === "WRITE" || action.type === "UPDATE") &&
                    typeof action.content !== "string") {
                    return false;
                }
            }
        }
        return true;
    }
    static loadSchema(schemaFile) {
        if (this.compiledSchemas[schemaFile]) {
            return this.compiledSchemas[schemaFile];
        }
        const schemaPath = path_1.default.join(__dirname, "..", "schemas", schemaFile);
        const schemaJSON = JSON.parse(fs_1.default.readFileSync(schemaPath, "utf-8"));
        const validate = this.ajv.compile(schemaJSON);
        this.compiledSchemas[schemaFile] = validate;
        return validate;
    }
    static validate(schemaFile, data) {
        const validate = this.loadSchema(schemaFile);
        const valid = validate(data);
        if (!valid) {
            logger_1.logger.error("SCHEMA_VALIDATION_FAILED", {
                schemaFile,
                errors: validate.errors
            });
            throw new Error(`Schema validation failed for ${schemaFile}: ${JSON.stringify(validate.errors)}`);
        }
        return true;
    }
}
exports.SchemaValidator = SchemaValidator;
_a = SchemaValidator;
SchemaValidator.ajv = new ajv_1.default({ allErrors: true }); // strict mode is on by default
SchemaValidator.compiledSchemas = {};
// Add support for standard formats (including date-time)
(() => {
    (0, ajv_formats_1.default)(_a.ajv);
})();
