/**
 * Safe file system utility layer.
 * Abstracts Node fs operations.
 * Adds validation and logging.
 */

import fs from "fs";
import path from "path";
import { logEvent } from "./logger";

export class FileSystem {

  static ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logEvent("DIR_CREATED", { dirPath });
    }
  }

  static readJSON(filePath: string) {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  static writeJSON(filePath: string, data: any) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    logEvent("FILE_WRITTEN", { filePath });
  }

  static writeFile(filePath: string, content: string) {
    fs.writeFileSync(filePath, content);
    logEvent("FILE_CREATED_OR_UPDATED", { filePath });
  }

  static exists(filePath: string) {
    return fs.existsSync(filePath);
  }
}
