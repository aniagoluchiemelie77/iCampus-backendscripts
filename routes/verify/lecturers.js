import express from "express";
import { verifyLecturer } from "../../controllers/signinActions.js";

export default function () {
  const router = express.Router();

  router.post("/verify-lecturer", verifyLecturer);
  return router;
}
