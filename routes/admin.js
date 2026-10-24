import express from "express";
import {
  protect,
  verifyAdmin,
  idempotencyMiddleware,
} from "../middleware/auth.js";
import {
  fetchAllAdmins,
  getNotifications,
  adminFetchUserDetails,
  adminFetchUserNotifications,
  getSupportTicketByRefId,
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
  getTaxEntries,
  downloadTaxReport,
  deleteAd,
  createAd,
  updateAd,
  sendSupportMessage,
} from "../controllers/adminActions.js";

const router = express.Router();

router.post(
  "/support/send-notification",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  adminSendTicketNotification,
);
router.get("/get-notifications", protect, verifyAdmin, getNotifications);
router.get("/get-overview", protect, verifyAdmin, getAdminMetrics);
router.get("/get-institutions", protect, verifyAdmin, getInstitutions);
router.get("/get-drop-off-stations", protect, verifyAdmin, getDropOffStations);
router.post(
  "/stations/create",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  createStation,
);
router.post(
  "/institutions/create",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  createInstitution,
);
router.get("/tax-entries/fetch", protect, verifyAdmin, getTaxEntries);
router.get("/tax-entries/download", protect, verifyAdmin, downloadTaxReport);
router.post(
  "/ads/create",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  createAd,
);
router.get("/fetch-all", protect, verifyAdmin, fetchAllAdmins);
router.post(
  "/create",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  createAdmin,
);
router.put(
  "/:uid/update",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateAdmin,
);
router.delete(
  "/:uid/delete",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  deleteAdmin,
);
router.get("/fetch-user/:userId", protect, verifyAdmin, adminFetchUserDetails);
router.get(
  "/fetch-notifications/:userId",
  protect,
  verifyAdmin,
  adminFetchUserNotifications,
);
router.patch(
  "/edit-users/:uid",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateUserController,
);
router.delete(
  "/institutions/:id/delete",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  deleteInstitution,
);
router.delete(
  "/stations/:id/delete",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  deleteDropOffStation,
);
router.patch(
  "/institutions/:id/update",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateInstitution,
);
router.patch(
  "/stations/:stationId/update",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
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
router.delete(
  "/ads/:id/delete",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  deleteAd,
);
router.patch(
  "/ads/:id/update",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateAd,
);
router.get(
  "/support-tickets/:ticketRefId/fetch",
  protect,
  verifyAdmin,
  getSupportTicketByRefId,
);
router.post(
  "/support-tickets/:ticketRefId/reply",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  sendSupportMessage,
);

export default router;