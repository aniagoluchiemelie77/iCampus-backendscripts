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
import {
  getSchoolSection,
  getSchoolReps,
  createSchoolRep,
  updateSchoolRep,
  deleteSchoolRep,
  sendSchoolNotification,
  getSchoolNotifications,
  getSchoolAuditLog,
  getSchoolUsers,
  exportSchoolData,
} from "../controllers/schoolAdminActions.js";
import {
  getFinanceOverview,
  getFinanceSection,
  updateSchoolBilling,
  exportFinanceData,
} from "../controllers/financeActions.js";
import {
  getPlatformOverview,
  getSupportOverview,
  getAdminDirectory,
  getAdminProfile,
  getAdminActivity,
  notifyAdminsDirectly,
  notifyUsersDirectly,
  getBroadcasts,
  getAdminInbox,
} from "../controllers/platformActions.js";
import {
  getSocialOverview,
  refreshSocialStats,
  exportSocialData,
} from "../controllers/socialActions.js";
import { adminActivityMiddleware } from "../utils/adminActivity.js";

const router = express.Router();

// Every successful admin write is recorded for the super admin's activity view.
router.use(adminActivityMiddleware);

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

// School administrators (A-level institution reps, B-level department reps).
router.get("/school/sections/:section", protect, verifyAdmin, getSchoolSection);
router.get("/school/reps", protect, verifyAdmin, getSchoolReps);
router.post(
  "/school/reps",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  createSchoolRep,
);
router.patch(
  "/school/reps/:uid",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateSchoolRep,
);
router.delete(
  "/school/reps/:uid",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  deleteSchoolRep,
);
router.get("/school/notifications", protect, verifyAdmin, getSchoolNotifications);
router.post(
  "/school/notifications",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  sendSchoolNotification,
);
router.get("/school/audit-log", protect, verifyAdmin, getSchoolAuditLog);
router.get("/school/users", protect, verifyAdmin, getSchoolUsers);
router.post("/school/exports", protect, verifyAdmin, exportSchoolData);

// Finance (finance + super admins).
router.get("/finance/overview", protect, verifyAdmin, getFinanceOverview);
router.get("/finance/sections/:section", protect, verifyAdmin, getFinanceSection);
router.patch(
  "/finance/schools/:id/billing",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  updateSchoolBilling,
);
router.post("/finance/export", protect, verifyAdmin, exportFinanceData);

// Super admin and support.
router.get("/platform/overview", protect, verifyAdmin, getPlatformOverview);
router.get("/platform/directory", protect, verifyAdmin, getAdminDirectory);
router.get("/platform/admins/:uid", protect, verifyAdmin, getAdminProfile);
router.get("/platform/activity", protect, verifyAdmin, getAdminActivity);
router.post(
  "/platform/notify-admins",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  notifyAdminsDirectly,
);
router.get("/support/overview", protect, verifyAdmin, getSupportOverview);
router.get("/support/broadcasts", protect, verifyAdmin, getBroadcasts);
router.post(
  "/notify-users",
  protect,
  verifyAdmin,
  idempotencyMiddleware,
  notifyUsersDirectly,
);
router.get("/inbox", protect, verifyAdmin, getAdminInbox);

// Social media (social media + super admins).
router.get("/social/overview", protect, verifyAdmin, getSocialOverview);
router.post("/social/refresh", protect, verifyAdmin, refreshSocialStats);
router.post("/social/export", protect, verifyAdmin, exportSocialData);

export default router;