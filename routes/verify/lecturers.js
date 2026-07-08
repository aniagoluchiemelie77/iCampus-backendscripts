import express from "express";
import { verifyLecturer } from "../../controllers/signinActions.js";

const router = express.Router();

router.post("/verify-lecturer", verifyLecturer);

export default router;
