import express from "express";
import { protect, verifyAdmin } from "../middleware/auth.js";
import {fetchAllAdmins} from '../controllers/fetchActions.js';
import {deleteAdmin} from '../controllers/adminActions.js';


export default function () {
  const router = express.Router();

  router.get("/fetch-all", protect, verifyAdmin, fetchAllAdmins);
  router.delete("/:uid/delete", protect, verifyAdmin, deleteAdmin);
  return router;
}