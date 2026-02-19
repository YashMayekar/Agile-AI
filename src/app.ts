/**
 * Express app configuration.
 * Defines middleware and routes.
 */

import express from "express";
import projectController from "./api/project.controller";

const app = express();

app.use(express.json());

// Main API route
app.use("/api/project", projectController);

export default app;
