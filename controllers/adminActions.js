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
} from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { createNotification } from "../services/notification.js";
import {
  generateNotificationId,
  generateSchoolId,
  generatePostId,
  generateStationId,
} from "../utils/idGenerator.js";

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
    await notifyAdmins(
      { role: "super_admin" },
      {
        notificationId: generateNotificationId("profile"),
        category: "profile",
        actionType: "ADMIN_DELETED",
        senderId: req.admin.uid,
        title: "Administrator Removed",
        message: `Admin ${deletedAdmin.firstname} was removed by ${req.admin.firstname}.`,
        payload: {
          deletedUid: uid,
          removedBy: req.admin.firstname,
        },
      },
      false,
    );

    res.status(200).json({ message: "Admin removed successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const createAdmin = async (req, res) => {
  if (req.admin.adminType !== "super_admin")
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const adminData = {
      ...req.body,
      createdAt: new Date(),
    };
    const adminRef = adminData.uid ? Admin.doc(adminData.uid) : Admin.doc();
    if (!adminData.uid) {
      adminData.uid = adminRef.id;
    }
    await adminRef.set(adminData);
    await notifyAdmins(
      { role: "super_admin" },
      {
        notificationId: generateNotificationId("profile"),
        category: "profile",
        actionType: "NEW_ADMIN_CREATED",
        title: "New Admin Added",
        message: `${req.admin.firstname} created a new admin account: ${newAdmin.firstname}.`,
        senderId: req.admin.uid,
        payload: { newAdminUid: newAdmin.uid },
      },
      false,
    );
    await notifyAdmins(
      { uids: [newAdmin.uid] },
      {
        notificationId: generateNotificationId("profile"),
        category: "profile",
        actionType: "WELCOME_ADMIN",
        title: "Welcome to iCampus Admin",
        message: `Your administrator account has been created by ${req.admin.firstname}.`,
        senderId: req.admin.uid,
        payload: {
          adminName: newAdmin.firstname,
          creatorName: req.admin.firstname,
        },
      },
      true,
    );

    res.status(201).json({ message: "Admin created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
export const updateAdmin = async (req, res) => {
  if (req.admin.adminType !== "super_admin")
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const { uid } = req.params;
    const adminRef = Admin.doc(uid);
    const adminDoc = await adminRef.get();
    if (!adminDoc.exists) {
      return res.status(404).json({ error: "Admin not found." });
    }

    const currentData = adminDoc.data();
    const updateData = {
      ...req.body,
      updatedAt: new Date(),
    };

    await adminRef.set(updateData, { merge: true });
    const updatedDoc = await adminRef.get();
    const updated = updatedDoc.data();
    await notifyAdmins(
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
    );

    if (req.body.adminType) {
      await notifyAdmins(
        { role: "super_admin" },
        {
          notificationId: generateNotificationId("profile"),
          category: "profile",
          actionType: "ADMIN_PERMISSIONS_CHANGED",
          title: "Permissions Modified",
          message: `Admin ${updated.firstname} role was changed to ${req.body.adminType} by ${req.admin.firstname}.`,
          senderId: req.admin.uid,
          payload: { targetUid: uid, newRole: req.body.adminType },
        },
        false,
      );
    }

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const ticketQuery = await SupportTicket.where(
      "ticketRefId",
      "==",
      ticketRefId,
    )
      .limit(1)
      .get();

    if (ticketQuery.empty) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }
    const ticketDoc = ticketQuery.docs[0];
    const ticketRef = ticketDoc.ref;
    const ticketData = ticketDoc.data();
    const userDoc = await User.doc(recipientId).get();
    const userData = userDoc.exists ? userDoc.data() : null;

    const notification = await createNotification({
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
    });
    const updatedTicketData = {
      ...ticketData,
      status: "pending",
      updatedAt: new Date(),
    };

    await ticketRef.set(updatedTicketData, { merge: true });
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
    const [
      usersSnapshot,
      transactionsSnapshot,
      payoutsSnapshot,
      pendingTicketsCount,
      recentSchoolsSnapshot,
      totalSchoolsCount,
      recentStationsSnapshot,
      totalStationsCount,
      latencySnapshot,
      taxesSnapshot,
    ] = await Promise.all([
      User.where("isSuspended", "==", false).get(),
      Transactions.where("status", "==", "success").get(),
      Payout.get(),
      SupportTicket.where("status", "in", ["open", "pending"])
        .get()
        .then((snap) => snap.size),
      OperationalInstitutions.orderBy("createdAt", "desc").limit(10).get(),
      OperationalInstitutions.get().then((snap) => snap.size),
      DropOffStation.orderBy("createdAt", "desc").limit(10).get(),
      DropOffStation.get().then((snap) => snap.size),
      ControllerLog.limit(10).get(),
      TaxEntries.orderBy("date", "desc").limit(10).get(),
    ]);
    let totalLiquidity = 0;
    let totalUsers = 0;
    const locationCounts = {};

    usersSnapshot.forEach((doc) => {
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

    const locationStats = Object.keys(locationCounts)
      .map((loc) => ({ _id: loc, count: locationCounts[loc] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const trendMap = {};
    transactionsSnapshot.forEach((doc) => {
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

    const sortedDates = Object.keys(trendMap).sort();
    const liquidityTrend = {
      labels: sortedDates,
      inFlow: sortedDates.map((date) => trendMap[date].inFlow),
      outFlow: sortedDates.map((date) => trendMap[date].outFlow),
    };
    const payoutMap = {};
    payoutsSnapshot.forEach((doc) => {
      const payout = doc.data();
      const status = payout.status || "unknown";
      if (!payoutMap[status]) {
        payoutMap[status] = { _id: status, totalAmount: 0, count: 0 };
      }
      payoutMap[status].totalAmount += payout.amount || 0;
      payoutMap[status].count += 1;
    });
    const payoutStats = Object.values(payoutMap);
    let totalLatency = 0;
    let latencyCount = 0;
    latencySnapshot.forEach((doc) => {
      const log = doc.data();
      if (typeof log.latency === "number") {
        totalLatency += log.latency;
        latencyCount += 1;
      }
    });
    const avgLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
    const recentSchools = recentSchoolsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const recentStations = recentStationsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    const recentTaxes = taxesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.json({
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
    res.status(500).json({ error: "Failed to fetch dashboard metrics" });
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
    const totalDocs = totalCountSnapshot.size;
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
    const totalDocs = totalCountSnapshot.size;
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
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

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

    await notifyAdmins(
      { role: "super_admin" },
      {
        notificationId: generateNotificationId("social"),
        category: "social",
        actionType: "ADMIN_INSTITUTION_DELETED",
        title: "Institution Deleted",
        message: `Institution ${result.schoolName} was deleted by admin ${req.user.uid}.`,
        payload: { schoolName: result.schoolName },
      },
      false,
    );

    res.json({ success: true, message: "Institution deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server error." });
  }
};
export const deleteDropOffStation = async (req, res) => {
  try {
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

    const { id } = req.params;
    const snapshot = await DropOffStation.where("id", "==", id).limit(1).get();

    if (snapshot.empty)
      return res.status(404).json({ message: "Drop-off station not found." });
    const stationDocRef = snapshot.docs[0].ref;
    const station = snapshot.docs[0].data();
    await stationDocRef.delete();

    await createNotification({
      recipientId: station.agentId,
      category: "system",
      actionType: "STATION_DELETION",
      title: "Station Removed",
      message: `Your drop-off station "${station.name}" has been removed from the platform. Please contact the support team to rectify this, if action not done with your consent.`,
      payload: { stationName: station.name },
    });
    await notifyAdmins(
      { role: "super_admin" },
      {
        notificationId: generateNotificationId("store"),
        category: "store",
        actionType: "STATION_DELETION_ADMIN",
        title: "Station Deletion Audit",
        message: `Station "${station.name}" ( by Agent: ${station.agentId}) was deleted.`,
        payload: { stationName: station.name, agentId: station.agentId },
      },
      false,
    );

    res.json({ success: true, message: "Station deleted successfully." });
  } catch (error) {
    res.status(500).json({ message: "Internal server error during deletion." });
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
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

    const adminUserId = process.env.APP_USERID;
    const schoolId = generateSchoolId(schoolName);
    const institutionData = {
      id: schoolId,
      schoolName,
      contactEmail,
      schoolCode: schoolId,
      logo,
      createdAt: new Date(),
    };
    await OperationalInstitutions.doc(schoolId).set(institutionData);

    const configData = {
      schoolId,
      name: schoolName,
      countryCode,
      domainWhitelist,
      isOperational,
      verificationMethod,
      externalApiConfig,
      ssoConfig,
      createdAt: new Date(),
    };
    await SchoolConfiguration.doc(schoolId).set(configData);

    await notifyAdmins(
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
    );
    const newPostId = generatePostId();
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
      createdAt: new Date(),
    };
    await Posts.doc(newPostId).set(welcomePostData);

    if (req.io) {
      req.io.emit("new_post", welcomePostData);
    }

    res.status(201).json({ success: true, institution: institutionData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
export const updateInstitution = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

    const instSnapshot = await OperationalInstitutions.where("id", "==", id)
      .limit(1)
      .get();
    const configSnapshot = await SchoolConfiguration.where("schoolId", "==", id)
      .limit(1)
      .get();

    if (instSnapshot.empty || configSnapshot.empty) {
      return res.status(404).json({ message: "Institution not found." });
    }
    const instRef = instSnapshot.docs[0].ref;
    const configRef = configSnapshot.docs[0].ref;
    const updatedSchoolData = {
      schoolName: updateData.name,
      contactEmail: updateData.contactEmail,
      logo: updateData.logo,
      updatedAt: new Date(),
    };

    const updatedConfigData = {
      name: updateData.name,
      countryCode: updateData.countryCode,
      domainWhitelist: updateData.domainWhitelist,
      isOperational: updateData.isOperational,
      verificationMethod: updateData.verificationMethod,
      ssoConfig: updateData.ssoConfig,
      externalApiConfig: updateData.externalApiConfig,
      updatedAt: new Date(),
    };
    await Promise.all([
      instRef.set(updatedSchoolData, { merge: true }),
      configRef.set(updatedConfigData, { merge: true }),
    ]);
    await notifyAdmins(
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
    );

    res.status(200).json({ success: true, data: updatedSchoolData });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ message: "Failed to update institution." });
  }
};
export const createStation = async (req, res) => {
  const { name, address, contactPerson, latitude, longitude, agentId, images } =
    req.body;

  try {
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

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
    await createNotification({
      recipientId: agentId,
      category: "system",
      actionType: "STATION_CREATED",
      title: "New Station Assigned",
      message: `A new drop-off station "${name}" has been assigned to your account.`,
      payload: { stationId, stationName: name },
    });
    await notifyAdmins(
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
    );
    res.status(201).json({ success: true, station: stationData });
  } catch (error) {
    console.error("Station Creation Error:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create station." });
  }
};
export const updateStation = async (req, res) => {
  const { stationId: id } = req.params;
  const updateData = req.body;

  try {
    if (req.admin.adminType !== "super_admin")
      return res.status(403).json({ error: "Unauthorized" });

    const snapshot = await DropOffStation.where("id", "==", id).limit(1).get();

    if (snapshot.empty) {
      return res
        .status(404)
        .json({ success: false, message: "Station not found." });
    }

    const stationDocRef = snapshot.docs[0].ref;
    const existingStationData = snapshot.docs[0].data();
    const finalUpdatePayload = {
      ...updateData,
      updatedAt: new Date(),
    };
    await stationDocRef.set(finalUpdatePayload, { merge: true });
    const updatedSnapshot = await stationDocRef.get();
    const updatedStation = { id, ...updatedSnapshot.data() };

    await createNotification({
      recipientId: updatedStation.agentId,
      category: "system",
      actionType: "STATION_UPDATED",
      title: "Station Details Updated",
      message: `Your station "${updatedStation.name}" details has been updated by iCampus administrators, please notify our support if you did not authorize this action.`,
      payload: { stationId: id, stationName: updatedStation.name },
    });
    await notifyAdmins(
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
    );

    res.status(200).json({ success: true, station: updatedStation });
  } catch (error) {
    console.error("Station Update Error:", error);
    res.status(500).json({ success: false, message: "Server error." });
  }
};
export const getInstitutionDetails = async (req, res) => {
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

  res.json({
    schoolName: schoolData.schoolName,
    contactEmail: schoolData.contactEmail,
    logo: schoolData.logo,
    studentCount: studentsSnapshot.size,
    lecturerCount: lecturersSnapshot.size,
  });
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
    let agentData = null;
    if (station.agentId) {
      const agentDoc = await User.doc(station.agentId).get();
      if (agentDoc.exists) {
        agentData = agentDoc.data();
      }
    }
    res.json({
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
    res.status(500).json({ message: "Server error" });
  }
};