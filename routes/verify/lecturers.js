import express from "express";
import { verifyLecturer } from "../../controllers/signinActions.js";

export default function () {
  const router = express.Router();
  /*
    If the school won't give you SSO access, you ask their IT department to build a single, lightweight endpoint for you, or adapt to their existing Enterprise Resource Planning (ERP) software (like Banner, EduTech, or custom setups).
    You provide them with a strict API contract.
    No matter what language they write in, they must expose an endpoint like this: POST https://api.university.edu/v1/verify-student
  */
  router.post("/verify-lecturer", verifyLecturer);
  return router;
}
