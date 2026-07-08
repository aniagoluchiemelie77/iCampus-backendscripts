import express from "express";
import { verifyStudent } from "../../controllers/signinActions.js";

const router = express.Router();

router.post("/verify", verifyStudent);

export default router;
