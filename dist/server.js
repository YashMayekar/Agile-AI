"use strict";
/**
 * Entry point of the backend server.
 * Responsible only for bootstrapping the application.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
dotenv_1.default.config();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "localhost";
const router = express_1.default.Router();
router.get("/", (req, res) => {
    res.json({
        status: "OK",
        message: "Welcome to the Agile AI Backend API. Please refer to the documentation for usage details."
    });
});
app_1.default.use(router);
app_1.default.listen(PORT, () => {
    console.log(`Agile AI Backend running on http://${HOST}:${PORT}`);
});
