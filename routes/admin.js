import express from "express";
import { protect, verifyAdmin } from "../middleware/auth.js";
import {
  fetchAllAdmins,
  getNotifications,
} from "../controllers/fetchActions.js";
import {
  deleteAdmin,
  updateAdmin,
  createAdmin,
} from "../controllers/adminActions.js";

export default function () {
  const router = express.Router();

  router.get("/fetch-all", protect, verifyAdmin, fetchAllAdmins);
  router.post("/create", protect, verifyAdmin, createAdmin);
  router.put("/:uid/update", protect, verifyAdmin, updateAdmin);
  router.delete("/:uid/delete", protect, verifyAdmin, deleteAdmin);
  router.get("/get-notifications", protect, verifyAdmin, getNotifications);
  return router;
}