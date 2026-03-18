import Ajv, { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import fs from "fs";
import path from "path";
import { logEvent } from "../utils/logger";

export class SchemaValidator {
  private static ajv = new Ajv({ allErrors: true }); // strict mode is on by default
  private static compiledSchemas: Record<string, ValidateFunction> = {};

  // Add support for standard formats (including date-time)
  static {
    addFormats(this.ajv);
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
      logEvent("SCHEMA_VALIDATION_FAILED", {
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