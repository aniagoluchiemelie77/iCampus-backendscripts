import {
  Admin,
  SupportTicket,
  User,
  Transactions,
  Payout,
  OperationalInstitutions,
  DropOffStation,
  ControllerLog,
  SchoolConfiguration,
  Posts,
  TaxEntries,
  TaxStatements,
  Ads,
} from "../tableDeclarations.js";
import { setImmediate } from "timers";
import { notifyAdmins } from "../services/adminNotification.js";
import { createNotification } from "../services/notification.js";
import {
  generateNotificationId,
  generateSchoolId,
  generatePostId,
  generateStationId,
  generateAdId,
} from "../utils/idGenerator.js";
import { generateTaxStatementPDF } from "../templates/taxEntriesTemplate.js";
import { storage } from "../config/firebaseAdmin.js";
import { taxReportEmailTemplate } from "../services/emailTemplates.js";
import { sendEmail } from "../services/emailService.js";

const now = new Date();
const formattedDate = now.toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const formattedTime = now.toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

export const deleteAdmin = async (req, res) => {
  try {
    const { uid } = req.params;
    const requester = req.admin;

    if (requester.adminType !== "super_admin") {
      return res
        .status(403)
        .json({ error: "Only super admins can remove administrators." });
    }
    if (requester.uid === uid) {
      return res.status(400).json({ error: "You cannot remove yourself." });
    }

    const adminRef = Admin.doc(uid);
    const adminDoc = await adminRef.get();

    if (!adminDoc.exists) {
      return res.status(404).json({ error: "Admin not found." });
    }

    const adminData = adminDoc.data();
    await adminRef.delete();
    res.status(200).json({ message: "Admin removed successfully." });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("profile"),
          category: "profile",
          actionType: "ADMIN_DELETED",
          senderId: requester.uid,
          title: "Administrator Removed",
          message: `Admin ${adminData?.firstname || "Unknown"} was removed by ${requester.firstname}.`,
          payload: {
            deletedUid: uid,
            removedBy: requester.firstname,
          },
        },
        false,
      ).catch((err) => console.error("Background notification error:", err));
    });
  } catch (err) {
    console.error("deleteAdmin Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};
export const createAdmin = async (req, res) => {
  if (req.admin?.adminType !== "super_admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const adminRef = req.body.uid ? Admin.doc(req.body.uid) : Admin.doc();
    const generatedUid = req.body.uid || adminRef.id;

    const adminData = {
      ...req.body,
      uid: generatedUid,
      createdAt: new Date(),
    };
    await adminRef.set(adminData);
    res
      .status(200)
      .json({ message: "Admin created successfully", uid: generatedUid });
    setImmediate(() => {
      Promise.all([
        notifyAdmins(
          { role: "super_admin" },
          {
            notificationId: generateNotificationId("profile"),
            category: "profile",
            actionType: "NEW_ADMIN_CREATED",
            title: "New Admin Added",
            message: `${req.admin.firstname} created a new admin account: ${adminData.firstname || "New Admin"}.`,
            senderId: req.admin.uid,
            payload: { newAdminUid: generatedUid },
          },
          false,
        ),
        notifyAdmins(
          { uids: [generatedUid] },
          {
            notificationId: generateNotificationId("profile"),
            category: "profile",
            actionType: "WELCOME_ADMIN",
            title: "Welcome to iCampus Admin",
            message: `Your administrator account has been created by ${req.admin.firstname}.`,
            senderId: req.admin.uid,
            payload: {
              adminName: adminData.firstname || "Admin",
              creatorName: req.admin.firstname,
            },
          },
          true,
        ),
      ]).catch((err) =>
        console.error("Background admin creation notifications failed:", err),
      );
    });
  } catch (err) {
    console.error("createAdmin Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};
export const updateAdmin = async (req, res) => {
  if (req.admin?.adminType !== "super_admin") {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    const { uid } = req.params;
    const adminRef = Admin.doc(uid);
    const adminDoc = await adminRef.get();

    if (!adminDoc.exists) {
      return res.status(404).json({ error: "Admin not found." });
    }

    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };
    await adminRef.set(updateData, { merge: true });
    const updatedDoc = await adminRef.get();
    const updated = updatedDoc.data();
    res.status(200).json(updated);
    setImmediate(() => {
      const tasks = [
        notifyAdmins(
          { uids: [uid] },
          {
            notificationId: generateNotificationId("profile"),
            category: "profile",
            actionType: "ADMIN_PROFILE_UPDATED",
            title: "Account Updated",
            message: `Your administrator account profile has been updated by ${req.admin.firstname}.`,
            senderId: req.admin.uid,
            payload: { updatedFields: Object.keys(req.body) },
          },
          false,
        ),
      ];

      if (req.body.adminType) {
        tasks.push(
          notifyAdmins(
            { role: "super_admin" },
            {
              notificationId: generateNotificationId("profile"),
              category: "profile",
              actionType: "ADMIN_PERMISSIONS_CHANGED",
              title: "Permissions Modified",
              message: `Admin ${updated?.firstname || "User"} role was changed to ${req.body.adminType} by ${req.admin.firstname}.`,
              senderId: req.admin.uid,
              payload: { targetUid: uid, newRole: req.body.adminType },
            },
            false,
          ),
        );
      }

      Promise.all(tasks).catch((err) =>
        console.error("Background update notifications failed:", err),
      );
    });
  } catch (err) {
    console.error("updateAdmin Error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
};
export const adminSendTicketNotification = async (req, res) => {
  try {
    const { ticketRefId } = req.params;
    const { recipientId, title, message, category } = req.body;

    if (!message || !recipientId) {
      return res.status(400).json({
        success: false,
        message: "Message and recipientId are required.",
      });
    }
    const [ticketQuery, userDoc] = await Promise.all([
      SupportTicket.where("ticketRefId", "==", ticketRefId).limit(1).get(),
      User.doc(recipientId).get(),
    ]);

    if (ticketQuery.empty) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }

    const ticketDoc = ticketQuery.docs[0];
    const ticketRef = ticketDoc.ref;
    const ticketData = ticketDoc.data();
    const userData = userDoc.exists ? userDoc.data() : null;

    const now = new Date();
    const formattedDate = now.toLocaleDateString();
    const formattedTime = now.toLocaleTimeString();

    const updatedTicketData = {
      ...ticketData,
      status: "pending",
      updatedAt: now,
    };
    const [notification] = await Promise.all([
      createNotification({
        notificationId: generateNotificationId("system"),
        recipientId: recipientId,
        recipientEmail: userData?.email,
        category: category || "system",
        actionType: "SUPPORT_TICKET_REPLY",
        title: title || `Update on Ticket #${ticketRefId}`,
        message: message,
        sendEmail: true,
        payload: {
          userName: userData?.firstname || "User",
          ticketRefId,
          adminMessage: message,
          date: formattedDate,
          time: formattedTime,
        },
      }),
      ticketRef.set(updatedTicketData, { merge: true }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Notification sent and ticket status updated to pending.",
      notification,
      ticket: updatedTicketData,
    });
  } catch (error) {
    console.error("adminSendTicketNotification Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error sending notification.",
    });
  }
};
export const updateUserController = async (req, res) => {
  const { uid } = req.params;
  const updateData = req.body;
  const requestingAdmin = req.admin;
  const authorizedRoles = ["super_admin", "support"];

  if (
    !requestingAdmin ||
    !authorizedRoles.includes(requestingAdmin.adminType)
  ) {
    return res.status(403).json({
      success: false,
      message:
        "Access denied. You do not have permission to perform this action.",
    });
  }
  const allowedUpdates = [
    "firstname",
    "lastname",
    "username",
    "email",
    "isSuspended",
    "website",
    "department",
    "organizationName",
    "staffId",
    "matricNumber",
    "itagusername",
    "schoolName",
    "current_level",
  ];

  const filteredData = {};
  Object.keys(updateData).forEach((key) => {
    if (allowedUpdates.includes(key)) {
      filteredData[key] = updateData[key];
    }
  });

  try {
    const userRef = User.doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const finalUpdatePayload = {
      ...filteredData,
      updatedAt: new Date(),
    };
    await userRef.set(finalUpdatePayload, { merge: true });
    const updatedUserDoc = await userRef.get();

    const updatedUser = { uid, ...updatedUserDoc.data() };
    return res.status(200).json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error("Admin Update Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating user.",
      error: error.message,
    });
  }
};
export const getAdminMetrics = async (req, res) => {
  try {
    const adminType = req.admin?.adminType || req.user?.adminType;
    const schoolCode =
      req.admin?.schoolCode || req.user?.schoolCode || req.query?.schoolCode;

    if (!adminType) {
      return res
        .status(403)
        .json({ error: "Unauthorized: Missing admin type context." });
    }

    const needsUsers = [
      "super_admin",
      "finance",
      "analyst",
      "school_administrator",
      "support",
    ].includes(adminType);
    const needsTransactions = ["super_admin", "finance"].includes(adminType);
    const needsPayouts = ["super_admin", "finance"].includes(adminType);
    const needsTickets = ["super_admin", "support"].includes(adminType);
    const needsInstitutions = ["super_admin", "support"].includes(adminType);
    const needsStations = ["super_admin", "support"].includes(adminType);
    const needsLatency = ["super_admin", "analyst"].includes(adminType);
    const needsTaxes = ["super_admin", "finance"].includes(adminType);
    const needsSchoolMetrics =
      adminType === "school_administrator" || adminType === "super_admin";

    const promiseMap = {};

    if (needsUsers) {
      promiseMap.users = User.where("isSuspended", "==", false).get();
    }
    if (needsTransactions) {
      promiseMap.transactions = Transactions.where(
        "status",
        "==",
        "success",
      ).get();
    }
    if (needsPayouts) {
      promiseMap.payouts = Payout.get();
    }
    if (needsTickets) {
      promiseMap.tickets = SupportTicket.where("status", "in", [
        "open",
        "pending",
      ]).get();
    }
    if (needsInstitutions) {
      promiseMap.recentSchools = OperationalInstitutions.orderBy(
        "createdAt",
        "desc",
      )
        .limit(10)
        .get();
      promiseMap.totalSchools = OperationalInstitutions.get();
    }
    if (needsStations) {
      promiseMap.recentStations = DropOffStation.orderBy("createdAt", "desc")
        .limit(10)
        .get();
      promiseMap.totalStations = DropOffStation.get();
    }
    if (needsLatency) {
      promiseMap.latency = ControllerLog.limit(10).get();
    }
    if (needsTaxes) {
      promiseMap.taxes = TaxEntries.orderBy("date", "desc").limit(10).get();
    }

    if (needsSchoolMetrics && schoolCode) {
      promiseMap.schoolUsers = User.where("schoolCode", "==", schoolCode).get();
      promiseMap.schoolCourses = Course.where(
        "schoolCode",
        "==",
        schoolCode,
      ).get();
      promiseMap.schoolAssessments = Assessment.get();
      promiseMap.schoolTestSubs = TestSubmission.get();
      promiseMap.schoolAttendance = Attendance.get();
    }

    const keys = Object.keys(promiseMap);
    const values = await Promise.all(Object.values(promiseMap));
    const snapshots = {};
    keys.forEach((key, index) => {
      snapshots[key] = values[index];
    });

    let responsePayload = {};

    if (needsSchoolMetrics && snapshots.schoolCourses) {
      let verifiedStudents = 0;
      let verifiedLecturers = 0;
      const userMonthGrowth = {};
      const departmentCoursesCount = {};
      const courseIdsSet = new Set();

      if (snapshots.schoolUsers) {
        snapshots.schoolUsers.forEach((doc) => {
          const u = doc.data();
          const dateObj = u.createdAt?.toDate
            ? u.createdAt.toDate()
            : new Date(u.createdAt || Date.now());
          const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;

          if (!userMonthGrowth[monthKey]) {
            userMonthGrowth[monthKey] = { students: 0, lecturers: 0 };
          }

          if (u.usertype === "student" && u.isVerified) {
            verifiedStudents++;
            userMonthGrowth[monthKey].students++;
          } else if (u.usertype === "lecturer" && u.isVerified) {
            verifiedLecturers++;
            userMonthGrowth[monthKey].lecturers++;
          }
        });
      }

      let assignedCoursesCount = 0;
      let unassignedCoursesCount = 0;
      let totalStudentEnrollments = 0;

      snapshots.schoolCourses.forEach((doc) => {
        const course = doc.data();
        courseIdsSet.add(course.courseId);

        const dept = course.department || "General";
        departmentCoursesCount[dept] = (departmentCoursesCount[dept] || 0) + 1;

        if (
          Array.isArray(course.lecturerIds) &&
          course.lecturerIds.length > 0
        ) {
          assignedCoursesCount++;
        } else {
          unassignedCoursesCount++;
        }

        if (Array.isArray(course.studentsEnrolled)) {
          totalStudentEnrollments += course.studentsEnrolled.length;
        }
      });

      let totalAssessmentsCreated = 0;
      if (snapshots.schoolAssessments) {
        snapshots.schoolAssessments.forEach((doc) => {
          const assessment = doc.data();
          if (courseIdsSet.has(assessment.courseId)) {
            totalAssessmentsCreated++;
          }
        });
      }

      let totalTestSubmissions = 0;
      if (snapshots.schoolTestSubs) {
        snapshots.schoolTestSubs.forEach(() => {
          totalTestSubmissions++;
        });
      }

      let totalAttendanceLogs = 0;
      if (snapshots.schoolAttendance) {
        snapshots.schoolAttendance.forEach((doc) => {
          const att = doc.data();
          if (courseIdsSet.has(att.courseId)) {
            totalAttendanceLogs++;
          }
        });
      }

      responsePayload.schoolMetrics = {
        users: {
          verifiedStudents,
          verifiedLecturers,
          onboardingGrowth: Object.keys(userMonthGrowth)
            .sort()
            .map((month) => ({
              month,
              ...userMonthGrowth[month],
            })),
        },
        courses: {
          totalActiveCourses: snapshots.schoolCourses.size,
          departmentBreakdown: departmentCoursesCount,
          allocationStatus: {
            assigned: assignedCoursesCount,
            unassigned: unassignedCoursesCount,
          },
          studentEnrollmentDensity: totalStudentEnrollments,
        },
        academics: {
          totalAssessmentsCreated,
          testSubmissionsCount: totalTestSubmissions,
          attendanceSyncVolume: totalAttendanceLogs,
        },
      };

      if (adminType === "school_administrator") {
        return res.json(responsePayload);
      }
    }

    let totalLiquidity = 0;
    let totalUsers = 0;
    const locationCounts = {};

    if (snapshots.users) {
      snapshots.users.forEach((doc) => {
        const user = doc.data();
        totalUsers += 1;
        totalLiquidity += user.pointsBalance || 0;
        if (Array.isArray(user.sessions)) {
          user.sessions.forEach((session) => {
            const loc = session.location;
            if (loc) {
              locationCounts[loc] = (locationCounts[loc] || 0) + 1;
            }
          });
        }
      });
    }

    const locationStats = Object.keys(locationCounts)
      .map((loc) => ({ _id: loc, count: locationCounts[loc] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trendMap = {};
    if (snapshots.transactions) {
      snapshots.transactions.forEach((doc) => {
        const tx = doc.data();
        const txDate = tx.createdAt?.toDate
          ? tx.createdAt.toDate()
          : new Date(tx.createdAt);

        if (txDate >= sevenDaysAgo) {
          const month = String(txDate.getMonth() + 1).padStart(2, "0");
          const day = String(txDate.getDate()).padStart(2, "0");
          const dateKey = `${month}-${day}`;

          if (!trendMap[dateKey]) {
            trendMap[dateKey] = { inFlow: 0, outFlow: 0 };
          }

          const amount = tx.amountLocal || 0;
          if (tx.payType === "in") {
            trendMap[dateKey].inFlow += amount;
          } else if (tx.payType === "out") {
            trendMap[dateKey].outFlow += amount;
          }
        }
      });
    }

    const sortedDates = Object.keys(trendMap).sort();
    const liquidityTrend = {
      labels: sortedDates,
      inFlow: sortedDates.map((date) => trendMap[date].inFlow),
      outFlow: sortedDates.map((date) => trendMap[date].outFlow),
    };

    const payoutMap = {};
    if (snapshots.payouts) {
      snapshots.payouts.forEach((doc) => {
        const payout = doc.data();
        const status = payout.status || "unknown";
        if (!payoutMap[status]) {
          payoutMap[status] = { _id: status, totalAmount: 0, count: 0 };
        }
        payoutMap[status].totalAmount += payout.amount || 0;
        payoutMap[status].count += 1;
      });
    }
    const payoutStats = Object.values(payoutMap);

    let totalLatency = 0;
    let latencyCount = 0;
    if (snapshots.latency) {
      snapshots.latency.forEach((doc) => {
        const log = doc.data();
        if (typeof log.latency === "number") {
          totalLatency += log.latency;
          latencyCount += 1;
        }
      });
    }
    const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;

    const recentSchools = snapshots.recentSchools
      ? snapshots.recentSchools.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
      : [];
    const totalSchoolsCount = snapshots.totalSchools
      ? snapshots.totalSchools.size
      : 0;

    const recentStations = snapshots.recentStations
      ? snapshots.recentStations.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
      : [];
    const totalStationsCount = snapshots.totalStations
      ? snapshots.totalStations.size
      : 0;

    const recentTaxes = snapshots.taxes
      ? snapshots.taxes.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      : [];
    const pendingTicketsCount = snapshots.tickets ? snapshots.tickets.size : 0;

    return res.json({
      ...responsePayload,
      activeUsers: totalUsers,
      platformLiquidity: totalLiquidity,
      payoutStats,
      pendingTickets: pendingTicketsCount,
      recentSchools: {
        items: recentSchools,
        total: totalSchoolsCount,
      },
      recentStations: {
        items: recentStations,
        total: totalStationsCount,
      },
      latencyData: avgLatency,
      liquidityTrend:
        liquidityTrend.labels.length > 0
          ? liquidityTrend
          : { labels: [], inFlow: [], outFlow: [] },
      locationStats: locationStats,
      recentTaxes,
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard metrics" });
  }
};
export const getInstitutions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [snapshot, totalCountSnapshot] = await Promise.all([
      OperationalInstitutions.orderBy("createdAt", "desc").get(),
      OperationalInstitutions.get(),
    ]);

    const allInstitutions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const paginatedInstitutions = allInstitutions.slice(skip, skip + limit);
    res.json(paginatedInstitutions);
  } catch (error) {
    console.error("Get Institutions Error:", error);
    res.status(500).json({ message: "Failed to retrieve institutions" });
  }
};
export const getDropOffStations = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [snapshot, totalCountSnapshot] = await Promise.all([
      DropOffStation.orderBy("createdAt", "desc").get(),
      DropOffStation.get(),
    ]);

    const allStations = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const paginatedStations = allStations.slice(skip, skip + limit);
    res.json(paginatedStations);
  } catch (error) {
    console.error("Get Drop-Off Stations Error:", error);
    res.status(500).json({ message: "Failed to retrieve drop-off stations" });
  }
};
export const deleteInstitution = async (req, res) => {
  try {
    if (req.admin?.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const snapshot = await OperationalInstitutions.where("id", "==", id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "Institution not found." });
    }

    const docRef = snapshot.docs[0].ref;
    const result = snapshot.docs[0].data();
    await docRef.delete();
    res.json({ success: true, message: "Institution deleted successfully." });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("social"),
          category: "social",
          actionType: "ADMIN_INSTITUTION_DELETED",
          title: "Institution Deleted",
          message: `Institution ${result?.schoolName || "Unknown"} was deleted by admin ${req.user?.uid || req.admin?.uid || "System"}.`,
          payload: { schoolName: result?.schoolName },
        },
        false,
      ).catch((err) =>
        console.error(
          "Background institution deletion notification failed:",
          err,
        ),
      );
    });
  } catch (error) {
    console.error("deleteInstitution Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Internal server error." });
    }
  }
};
export const deleteDropOffStation = async (req, res) => {
  try {
    if (req.admin?.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const snapshot = await DropOffStation.where("id", "==", id).limit(1).get();

    if (snapshot.empty) {
      return res.status(404).json({ message: "Drop-off station not found." });
    }

    const stationDocRef = snapshot.docs[0].ref;
    const station = snapshot.docs[0].data();
    await stationDocRef.delete();
    res.json({ success: true, message: "Station deleted successfully." });
    setImmediate(() => {
      Promise.all([
        createNotification({
          recipientId: station?.agentId,
          category: "system",
          actionType: "STATION_DELETION",
          title: "Station Removed",
          message: `Your drop-off station "${station?.name || "Station"}" has been removed from the platform. Please contact the support team to rectify this, if action not done with your consent.`,
          payload: { stationName: station?.name },
        }),
        notifyAdmins(
          { role: "super_admin" },
          {
            notificationId: generateNotificationId("store"),
            category: "store",
            actionType: "STATION_DELETION_ADMIN",
            title: "Station Deletion Audit",
            message: `Station "${station?.name || "Station"}" (by Agent: ${station?.agentId || "Unknown"}) was deleted.`,
            payload: { stationName: station?.name, agentId: station?.agentId },
          },
          false,
        ),
      ]).catch((err) =>
        console.error("Background station deletion notifications failed:", err),
      );
    });
  } catch (error) {
    console.error("deleteDropOffStation Error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ message: "Internal server error during deletion." });
    }
  }
};
export const createInstitution = async (req, res) => {
  const {
    name: schoolName,
    contactEmail,
    logo,
    ssoConfig,
    externalApiConfig,
    verificationMethod,
    domainWhitelist,
    isOperational,
    countryCode,
  } = req.body;

  try {
    if (req.admin.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const adminUserId = process.env.APP_USERID;
    const schoolId = generateSchoolId(schoolName);
    const newPostId = generatePostId();
    const now = new Date();

    const institutionData = {
      id: schoolId,
      schoolName,
      contactEmail,
      schoolCode: schoolId,
      logo,
      createdAt: now,
    };

    const configData = {
      schoolId,
      name: schoolName,
      countryCode,
      domainWhitelist,
      isOperational,
      verificationMethod,
      externalApiConfig,
      ssoConfig,
      createdAt: now,
    };

    const welcomePostData = {
      postId: newPostId,
      originalAuthor: adminUserId,
      priorityScore: 10,
      media: {
        url: logo,
        mediaType: "image",
      },
      content: `Welcome to iCampus, ${schoolName}! Students and lecturers from this institution can now sign up and join our community.`,
      postType: "media",
      createdAt: now,
    };
    await Promise.all([
      OperationalInstitutions.doc(schoolId).set(institutionData),
      SchoolConfiguration.doc(schoolId).set(configData),
      Posts.doc(newPostId).set(welcomePostData),
    ]);
    res.status(200).json({ success: true, institution: institutionData });
    setImmediate(() => {
      if (req.io) {
        req.io.emit("new_post", welcomePostData);
      }

      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("social"),
          category: "social",
          actionType: "ADMIN_INSTITUTION_CREATED",
          title: "New Institution Joined",
          message: `${schoolName} has officially joined iCampus.`,
          payload: { schoolId, schoolName },
        },
        false,
      ).catch((err) =>
        console.error(
          "Background institution creation notification failed:",
          err,
        ),
      );
    });
  } catch (error) {
    console.error("Create Institution Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};
export const updateInstitution = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  try {
    if (req.admin.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const [instSnapshot, configSnapshot] = await Promise.all([
      OperationalInstitutions.where("id", "==", id).limit(1).get(),
      SchoolConfiguration.where("schoolId", "==", id).limit(1).get(),
    ]);

    if (instSnapshot.empty || configSnapshot.empty) {
      return res.status(404).json({ message: "Institution not found." });
    }

    const instRef = instSnapshot.docs[0].ref;
    const configRef = configSnapshot.docs[0].ref;
    const now = new Date();

    const updatedSchoolData = {
      schoolName: updateData.name,
      contactEmail: updateData.contactEmail,
      logo: updateData.logo,
      updatedAt: now,
    };

    const updatedConfigData = {
      name: updateData.name,
      countryCode: updateData.countryCode,
      domainWhitelist: updateData.domainWhitelist,
      isOperational: updateData.isOperational,
      verificationMethod: updateData.verificationMethod,
      ssoConfig: updateData.ssoConfig,
      externalApiConfig: updateData.externalApiConfig,
      updatedAt: now,
    };
    await Promise.all([
      instRef.set(updatedSchoolData, { merge: true }),
      configRef.set(updatedConfigData, { merge: true }),
    ]);
    res.status(200).json({ success: true, data: updatedSchoolData });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("social"),
          category: "social",
          actionType: "ADMIN_INSTITUTION_UPDATED",
          title: "Institution Updated",
          message: `Settings for "${updateData.name}" have been modified.`,
          payload: { schoolId: id, schoolName: updateData.name },
        },
        false,
      ).catch((err) =>
        console.error(
          "Background institution update notification failed:",
          err,
        ),
      );
    });
  } catch (error) {
    console.error("Update Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to update institution." });
    }
  }
};
export const createStation = async (req, res) => {
  const { name, address, contactPerson, latitude, longitude, agentId, images } =
    req.body;
  try {
    if (req.admin.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const stationId = generateStationId();
    const stationData = {
      id: stationId,
      name,
      address,
      contactPerson,
      latitude,
      longitude,
      agentId,
      images,
      createdAt: new Date(),
    };

    await DropOffStation.doc(stationId).set(stationData);
    res.status(200).json({ success: true, station: stationData });
    setImmediate(() => {
      Promise.all([
        createNotification({
          recipientId: agentId,
          category: "system",
          actionType: "STATION_CREATED",
          title: "New Station Assigned",
          message: `A new drop-off station "${name}" has been assigned to your account.`,
          payload: { stationId, stationName: name },
        }),
        notifyAdmins(
          { role: "super_admin" },
          {
            notificationId: generateNotificationId("store"),
            category: "store",
            actionType: "STATION_CREATED_ADMIN",
            title: "Station Creation Audit",
            message: `Station "${name}" was created for Agent: ${agentId}.`,
            payload: { stationId, stationName: name, agentId },
          },
          false,
        ),
      ]).catch((err) =>
        console.error("Background station creation notifications failed:", err),
      );
    });
  } catch (error) {
    console.error("Station Creation Error:", error);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ success: false, message: "Failed to create station." });
    }
  }
};
export const updateStation = async (req, res) => {
  const { stationId: id } = req.params;
  const updateData = req.body;
  try {
    if (req.admin.adminType !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const snapshot = await DropOffStation.where("id", "==", id).limit(1).get();
    if (snapshot.empty) {
      return res
        .status(404)
        .json({ success: false, message: "Station not found." });
    }
    const stationDocRef = snapshot.docs[0].ref;
    const finalUpdatePayload = {
      ...updateData,
      updatedAt: new Date(),
    };
    await stationDocRef.set(finalUpdatePayload, { merge: true });
    const updatedSnapshot = await stationDocRef.get();
    const updatedStation = { id, ...updatedSnapshot.data() };
    res.status(200).json({ success: true, station: updatedStation });
    setImmediate(() => {
      Promise.all([
        createNotification({
          recipientId: updatedStation.agentId,
          category: "system",
          actionType: "STATION_UPDATED",
          title: "Station Details Updated",
          message: `Your station "${updatedStation.name}" details has been updated by iCampus administrators, please notify our support if you did not authorize this action.`,
          payload: { stationId: id, stationName: updatedStation.name },
        }),
        notifyAdmins(
          { role: "super_admin" },
          {
            notificationId: generateNotificationId("store"),
            category: "store",
            actionType: "STATION_UPDATED_ADMIN",
            title: "Station Update Audit",
            message: `Station "${updatedStation.name}" (ID: ${id}) was updated.`,
            payload: { stationId: id, agentId: updatedStation.agentId },
          },
          false,
        ),
      ]).catch((err) =>
        console.error("Background station update notifications failed:", err),
      );
    });
  } catch (error) {
    console.error("Station Update Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: "Server error." });
    }
  }
};
export const getInstitutionDetails = async (req, res) => {
  try {
    const { schoolId } = req.params;
    const [studentsSnapshot, lecturersSnapshot, schoolSnapshot] =
      await Promise.all([
        User.where("schoolCode", "==", schoolId)
          .where("role", "==", "student")
          .get(),
        User.where("schoolCode", "==", schoolId)
          .where("role", "==", "lecturer")
          .get(),
        OperationalInstitutions.where("schoolCode", "==", schoolId)
          .limit(1)
          .get(),
      ]);

    if (schoolSnapshot.empty) {
      return res
        .status(404)
        .json({ success: false, message: "Institution not found." });
    }

    const schoolData = schoolSnapshot.docs[0].data();

    return res.json({
      schoolName: schoolData.schoolName,
      contactEmail: schoolData.contactEmail,
      logo: schoolData.logo,
      studentCount: studentsSnapshot.size,
      lecturerCount: lecturersSnapshot.size,
    });
  } catch (error) {
    console.error("Get Institution Details Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to retrieve details." });
  }
};
export const getStationDetails = async (req, res) => {
  const { stationId } = req.params;

  try {
    const stationSnapshot = await DropOffStation.where("id", "==", stationId)
      .limit(1)
      .get();

    if (stationSnapshot.empty) {
      return res.status(404).json({ message: "Station not found" });
    }

    const station = stationSnapshot.docs[0].data();
    const agentDoc = station.agentId
      ? await User.doc(station.agentId).get()
      : null;
    let agentData = agentDoc && agentDoc.exists ? agentDoc.data() : null;

    return res.json({
      stationName: station.name,
      address: station.address,
      agent: agentData
        ? {
            firstname: agentData.firstname || agentData.firstName,
            lastname: agentData.lastname || agentData.lastName,
            username: agentData.username,
            profilePic: agentData.profilePic,
            tier: agentData.tier,
            isVerified: agentData.isVerified,
            organizationName: agentData.organizationName,
          }
        : null,
    });
  } catch (error) {
    console.error("Get Station Details Error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
export const getTaxEntries = async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const snapshot = await TaxEntries.orderBy("date", "desc").get();
    const totalDocs = snapshot.size;
    const totalPages = Math.ceil(totalDocs / limit) || 1;
    const paginatedDocs = snapshot.docs.slice((page - 1) * limit, page * limit);

    const items = paginatedDocs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        transactionReference: data.transactionReference,
        taxType: data.taxType,
        amount: data.amount,
        currency: data.currency,
        date: data.date?.toDate ? data.date.toDate() : data.date,
        sourceDetails: data.sourceDetails
          ? {
              userId: data.sourceDetails.userId,
              relatedTransactionId: data.sourceDetails.relatedTransactionId,
            }
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      data: items,
      currentPage: page,
      totalPages: totalPages,
      totalEntries: totalDocs,
      message: "Tax entries loaded successfully",
    });
  } catch (error) {
    console.error("Get Tax Entries Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching tax entries",
    });
  }
};
export const downloadTaxReport = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "downloadTaxReportController";
  const action = "downloadTaxReport";

  try {
    const adminEmail = req.admin.email;
    const { month, year } = req.query;

    if (!month || !year) {
      return res.status(400).json({
        success: false,
        message: "Month and year parameters are required",
      });
    }

    if (parseInt(year) < 2026) {
      return res.status(400).json({
        success: false,
        message: "Reports are only available from year 2026 onwards",
      });
    }

    const start = new Date(
      Date.UTC(parseInt(year), parseInt(month) - 1, 1, 0, 0, 0, 0),
    );
    const end = new Date(
      Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59, 999),
    );

    const bucket = storage.bucket();
    const filePath = `tax-statements/iCampus/TaxReport-${year}-${month}.pdf`;
    const file = bucket.file(filePath);

    const statementQuery = await TaxStatements.where("startDate", "==", start)
      .where("endDate", "==", end)
      .limit(1)
      .get();

    let firebaseUrl;
    let totalTaxAmount = 0;
    let pdfBuffer;

    if (!statementQuery.empty) {
      const existingStatement = statementQuery.docs[0].data();
      firebaseUrl = existingStatement.pdfUrl;
      totalTaxAmount = existingStatement.totalTaxAmount || 0;

      const [downloadBuffer] = await file.download();
      pdfBuffer = downloadBuffer;
    } else {
      const taxQuery = await TaxEntries.where("date", ">=", start)
        .where("date", "<=", end)
        .orderBy("date", "desc")
        .get();

      const history = [];
      taxQuery.forEach((doc) => {
        const data = doc.data();
        totalTaxAmount += data.amount || 0;
        history.push({
          ...data,
          date: data.date?.toDate ? data.date.toDate() : data.date,
        });
      });

      if (history.length === 0) {
        return res.status(404).json({
          success: false,
          message: `No tax records found for ${month}/${year}.`,
        });
      }

      pdfBuffer = await generateTaxStatementPDF({
        start,
        end,
        totalTaxAmount,
        history,
      });

      await file.save(pdfBuffer, {
        metadata: { contentType: "application/pdf" },
        public: true,
      });

      firebaseUrl = `https://storage.googleapis.com/${bucket.name}/${file.name}`;

      const statementId = `tax-stmt-icampus-${year}-${month}`;
      await TaxStatements.doc(statementId).set({
        statementId,
        startDate: start,
        endDate: end,
        pdfUrl: firebaseUrl,
        totalTaxAmount,
        createdAt: new Date(),
      });
    }

    const monthName = start.toLocaleString("en-US", { month: "long" });
    res.status(200).json({
      success: true,
      message: "Tax report generated successfully and emailed.",
      pdfUrl: firebaseUrl,
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    setImmediate(async () => {
      try {
        const emailHtml = taxReportEmailTemplate(
          monthName,
          year,
          totalTaxAmount,
          firebaseUrl,
        );
        await sendEmail({
          to: adminEmail || process.env.POSTMARK_SENDER_SIGNATURE,
          subject: `iCampus Tax Report: ${monthName} ${year}`,
          text: `The iCampus tax report for ${monthName} ${year} has been generated. Total Tax: ${totalTaxAmount} iCash.`,
          html: emailHtml,
          attachments: [
            {
              filename: `iCampus_Tax_Report_${year}_${month}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ],
        });
      } catch (emailErr) {
        console.error("Background tax report email dispatch failed:", emailErr);
      }
    });
  } catch (error) {
    console.error("Download Tax Report Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }
};
export const deleteAd = async (req, res) => {
  try {
    const adminType = req.admin?.adminType;
    const adminId = req.admin?.uid || req.admin?.id;

    if (!["super_admin", "school_administrator"].includes(adminType)) {
      return res.status(403).json({
        success: false,
        error:
          "Unauthorized. Super admin or school administrator access required.",
      });
    }

    const { id } = req.params;
    const snapshot = await Ads.where("id", "==", id).limit(1).get();

    if (snapshot.empty) {
      return res
        .status(404)
        .json({ success: false, message: "Advertisement not found." });
    }

    const adDocRef = snapshot.docs[0].ref;
    const adData = snapshot.docs[0].data();
    await adDocRef.delete();
    res.status(200).json({
      success: true,
      message: "Advertisement deleted successfully.",
    });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("system"),
          category: "system",
          actionType: "AD_DELETION_ADMIN",
          title: "Advertisement Deletion Audit",
          message: `Advertisement "${adData.advertiserName || "Unknown"}" (ID: ${id}) was deleted by admin ${adminId}.`,
          payload: { adId: id, advertiserName: adData.advertiserName },
        },
        false,
      ).catch((err) =>
        console.error("Background ad deletion audit failed:", err),
      );
    });
  } catch (error) {
    console.error("Delete Ad Error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Internal server error during deletion.",
      });
    }
  }
};
export const createAd = async (req, res) => {
  try {
    const adminType = req.admin?.adminType;
    const adminId = req.admin?.uid || req.admin?.id;

    if (!["super_admin", "school_administrator"].includes(adminType)) {
      return res.status(403).json({
        success: false,
        error:
          "Unauthorized. Super admin or school administrator access required.",
      });
    }
    if (adminType === "school_administrator") {
      const existingAdsSnapshot = await Ads.where(
        "addedBy",
        "==",
        adminId,
      ).get();
      if (!existingAdsSnapshot.empty) {
        return res.status(400).json({
          success: false,
          error:
            "Slot exhausted. School administrators are only permitted 1 active advertisement slot.",
        });
      }
    }

    const {
      type,
      mediaUrl,
      targetUrl,
      advertiserLogo,
      advertiserName,
      tagline,
    } = req.body;
    const schoolCode = req.admin?.schoolCode;

    if (!advertiserName || !mediaUrl || !advertiserLogo) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields (advertiserName, mediaUrl, advertiserLogo).",
      });
    }
    const adId = generateAdId(advertiserName);
    const newAd = {
      id: adId,
      type: type || "image",
      mediaUrl,
      targetUrl: targetUrl || "",
      advertiserLogo,
      advertiserName,
      tagline: tagline || "",
      addedBy: adminId,
      creatorType: adminType,
      schoolCode: schoolCode || req.admin?.schoolCode || "",
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: req.admin.email || adminId,
    };
    await Ads.doc(adId).set(newAd);
    res.status(200).json({
      success: true,
      message: "Advertisement created successfully.",
      data: newAd,
    });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("system"),
          category: "system",
          actionType: "AD_CREATION_ADMIN",
          title: "Advertisement Created Audit",
          message: `New advertisement for "${advertiserName}" (ID: ${adId}) was created by a ${adminType}.`,
          payload: { adId, advertiserName, addedBy: adminId },
        },
        false,
      ).catch((err) =>
        console.error("Background ad creation audit failed:", err),
      );
    });
  } catch (error) {
    console.error("Create Ad Error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Internal server error during ad creation.",
      });
    }
  }
};
export const updateAd = async (req, res) => {
  try {
    const adminType = req.admin?.adminType;
    if (!["super_admin", "school_administrator"].includes(adminType)) {
      return res.status(403).json({
        success: false,
        error:
          "Unauthorized. Super admin or school administrator access required.",
      });
    }

    const { id } = req.params;
    const updateData = req.body;
    const snapshot = await Ads.where("id", "==", id).limit(1).get();
    if (snapshot.empty) {
      return res
        .status(404)
        .json({ success: false, error: "Advertisement not found." });
    }
    const adDocRef = snapshot.docs[0].ref;
    const existingAd = snapshot.docs[0].data();
    const payload = {
      ...updateData,
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email || req.admin.id,
    };
    delete payload.id;
    await adDocRef.update(payload);
    const updatedSnapshot = await adDocRef.get();
    const updatedAd = updatedSnapshot.data();
    res.status(200).json({
      success: true,
      message: "Advertisement updated successfully.",
      ad: updatedAd,
    });
    setImmediate(() => {
      notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("system"),
          category: "system",
          actionType: "AD_UPDATE_ADMIN",
          title: "Advertisement Updated Audit",
          message: `Advertisement "${updatedAd.advertiserName || existingAd.advertiserName}" (ID: ${id}) was updated.`,
          payload: {
            adId: id,
            advertiserName:
              updatedAd.advertiserName || existingAd.advertiserName,
          },
        },
        false,
      ).catch((err) =>
        console.error("Background ad update audit failed:", err),
      );
    });
  } catch (error) {
    console.error("Update Ad Error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "Internal server error during ad update.",
      });
    }
  }
};
export const sendSupportMessage = async (req, res) => {
  try {
    const { ticketRefId } = req.params;
    const { message, attachments = [] } = req.body;
    const currentUserId = req.user.id || req.user.uid;

    if (!ticketRefId || (!message && attachments.length === 0)) {
      return res.status(400).json({
        success: false,
        message:
          "Ticket reference ID and message content or attachments are required.",
      });
    }

    const isAdmin =
      req.user.adminType === "support" || req.user.adminType === "super_admin";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to this support ticket thread.",
      });
    }

    const ticketSnapshot = await SupportTicket.where(
      "ticketRefId",
      "==",
      ticketRefId,
    )
      .limit(1)
      .get();

    if (ticketSnapshot.empty) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found.",
      });
    }

    const ticketDoc = ticketSnapshot.docs[0];
    const ticketData = ticketDoc.data();

    const newMessage = {
      sender: currentUserId,
      message: message || "",
      attachments: attachments,
      timestamp: new Date().toISOString(),
    };

    const updatedThread = [...(ticketData.thread || []), newMessage];
    await ticketDoc.ref.update({
      thread: updatedThread,
      updatedAt: new Date().toISOString(),
    });
    res.status(200).json({
      success: true,
      message: "Message sent successfully.",
      data: newMessage,
    });
    setImmediate(async () => {
      try {
        if (isAdmin && ticketData.source === "email" && ticketData.guestEmail) {
          await sendEmail({
            to: ticketData.guestEmail,
            subject: `Update on Support Ticket: Ref ${ticketRefId}`,
            text: message,
            html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
            attachments: attachments,
          });
        }
      } catch (emailError) {
        console.error("Background support email dispatch failed:", emailError);
      }

      try {
        await notifyAdmins(
          { role: "super_admin" },
          {
            notificationId: generateNotificationId("system"),
            category: "system",
            actionType: "SUPPORT_MESSAGE_REPLY",
            title: "New Support Ticket Message",
            message: `New message added to ticket Ref: ${ticketRefId}`,
            payload: { ticketRefId: ticketRefId },
          },
          false,
        );
      } catch (notificationError) {
        console.error(
          "Background support audit notification failed:",
          notificationError,
        );
      }
    });
  } catch (error) {
    console.error("Backend sendSupportMessage Error:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  }
};

//Tested and trusted using jest