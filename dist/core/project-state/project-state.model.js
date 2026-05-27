"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDirectory = isDirectory;
/**
 * Type guard to check if a node is a directory.
 */
function isDirectory(node) {
    return node.children !== undefined;
}
