import express from "express";
import { protect, verifyAdmin } from "../middleware/auth.js";
import {
  fetchAllAdmins,
  getNotifications,
  adminFetchUserDetails,
  adminFetchUserNotifications,
} from "../controllers/fetchActions.js";
import {
  deleteAdmin,
  updateAdmin,
  createAdmin,
  adminSendTicketNotification,
  updateUserController,
  getAdminMetrics,
  getInstitutions,
  getDropOffStations,
  deleteInstitution,
  deleteDropOffStation,
  createInstitution,
  updateInstitution,
  createStation,
  updateStation,
  getInstitutionDetails,
  getStationDetails,
} from "../controllers/adminActions.js";

export default function () {
  const router = express.Router();

  router.get("/fetch-all", protect, verifyAdmin, fetchAllAdmins);
  router.post("/create", protect, verifyAdmin, createAdmin);
  router.put("/:uid/update", protect, verifyAdmin, updateAdmin);
  router.delete("/:uid/delete", protect, verifyAdmin, deleteAdmin);
  router.get("/get-notifications", protect, verifyAdmin, getNotifications);
  router.get(
    "/fetch-user/:userId",
    protect,
    verifyAdmin,
    adminFetchUserDetails,
  );
  router.get(
    "/fetch-notifications/:userId",
    protect,
    verifyAdmin,
    adminFetchUserNotifications,
  );
  router.post(
    "/support/send-notification",
    protect,
    verifyAdmin,
    adminSendTicketNotification,
  );
  router.patch("/edit-users/:uid", protect, verifyAdmin, updateUserController);
  router.get("/get-overview", protect, verifyAdmin, getAdminMetrics);
  router.get("/get-institutions", protect, verifyAdmin, getInstitutions);
  router.get(
    "/get-drop-off-stations",
    protect,
    verifyAdmin,
    getDropOffStations,
  );
  router.delete(
    "/institutions/:id/delete",
    protect,
    verifyAdmin,
    deleteInstitution,
  );
  router.delete(
    "/stations/:id/delete",
    protect,
    verifyAdmin,
    deleteDropOffStation,
  );
  router.post("/institutions/create", protect, verifyAdmin, createInstitution);
  router.patch(
    "/institutions/:id/update",
    protect,
    verifyAdmin,
    updateInstitution,
  );
  router.post("/stations/create", protect, verifyAdmin, createStation);
  router.patch(
    "/stations/:stationId/update",
    protect,
    verifyAdmin,
    updateStation,
  );
  router.get(
    "/institutions/:schoolId/get-details",
    protect,
    verifyAdmin,
    getInstitutionDetails,
  );
  router.get(
    "/stations/:stationId/details",
    protect,
    verifyAdmin,
    getStationDetails,
  );
  return router;
}