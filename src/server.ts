/**
 * Entry point of the backend server.
 * Responsible only for bootstrapping the application.
 */

import app from "./app";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "localhost";

const router = express.Router();
router.get("/", (req, res) => {
  res.json({ status: "OK",
    message: "Welcome to the Agile AI Backend API. Please refer to the documentation for usage details." });
});
   
app.use(router);

app.listen(PORT, () => {
  console.log(`Agile AI Backend running on http://${HOST}:${PORT}`);
});
