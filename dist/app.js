"use strict";
/**
 * Express app configuration.
 * Defines middleware and routes.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const project_controller_1 = __importDefault(require("./api/project.controller"));
const app = (0, express_1.default)();
app.use(express_1.default.json());
// Main API route
app.use("/api/project", project_controller_1.default);
exports.default = app;
