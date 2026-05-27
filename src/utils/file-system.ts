/**
 * Safe file system utility layer.
 * Abstracts Node fs operations.
 * Adds validation and logging.
 */

import fs from "fs";
import { logger } from "./logger";

export class FileSystem {

  static ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      logger.debug("DIR_CREATED", { dirPath });
    }
  }

  static deleteDir(dirPath: string) {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      logger.debug("DIR_DELETED", { dirPath });
    }
  }

  static readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  static readJSON(filePath: string) {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  static writeJSON(filePath: string, data: any) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    logger.debug("FILE_WRITTEN", { filePath });
  }

  static writeFile(filePath: string, content: string) {
    fs.writeFileSync(filePath, content);
    logger.debug("FILE_CREATED_OR_UPDATED", { filePath });
  }

  static exists(filePath: string) {
    return fs.existsSync(filePath);
  }
}
