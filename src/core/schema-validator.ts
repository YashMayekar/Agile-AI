import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";


type ActionType = "READ" | "WRITE" | "UPDATE" | "DELETE" | "SWITCH-AG" | "WORKFLOW";

interface Action {
  type: ActionType;
  target: string;
  content?: string;
}



export class SchemaValidator {
  private static ajv = new Ajv({ allErrors: true }); // strict mode is on by default
  private static compiledSchemas: Record<string, ValidateFunction> = {};

  // Add support for standard formats (including date-time)
  static {
    addFormats(this.ajv);
  }

  public static validateIntentResponse(raw: string): boolean {
    // 1. Extract JSON block (first {...} found)
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return false;

    let parsed: any;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return false;
    }

    // 2. Validate root
    if (!Array.isArray(parsed.actions)) return false;

    // 3. Validate actions
    const validTypes: ActionType[] = [
      "READ", "WRITE", "UPDATE", "DELETE", "SWITCH-AG", "WORKFLOW"
    ];

    if (parsed.actions.length > 0) {
      for (const action of parsed.actions) {
      if (!validTypes.includes(action.type)) return false;
      if (typeof action.target !== "string") return false;

      // content required only for WRITE and UPDATE
      if (
        (action.type === "WRITE" || action.type === "UPDATE") &&
        typeof action.content !== "string"
      ) {
        return false;
      }
    }
  }

    return true;
  }

  private static loadSchema(schemaFile: string): ValidateFunction {
    if (this.compiledSchemas[schemaFile]) {
      return this.compiledSchemas[schemaFile];
    }

    const schemaPath = path.join(__dirname, "..", "schemas", schemaFile);
    const schemaJSON = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

    const validate = this.ajv.compile(schemaJSON);
    this.compiledSchemas[schemaFile] = validate;

    return validate;
  }

  static validate(schemaFile: string, data: any) {
    const validate = this.loadSchema(schemaFile);
    const valid = validate(data);

    if (!valid) {
      logger.error("SCHEMA_VALIDATION_FAILED", {
        schemaFile,
        errors: validate.errors
      });

      throw new Error(
        `Schema validation failed for ${schemaFile}: ${JSON.stringify(validate.errors)}`
      );
    }

    return true;
  }
}