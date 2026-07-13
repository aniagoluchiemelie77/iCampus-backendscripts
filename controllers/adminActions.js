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

    const deletedAdmin = await Admin.findOneAndDelete({ uid });

    if (!deletedAdmin) {
      return res.status(404).json({ error: "Admin not found." });
    }
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
    const newAdmin = new Admin(req.body);
    await newAdmin.save();
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
    const updated = await Admin.findOneAndUpdate({ uid }, req.body, {
      new: true,
    });

    if (!updated) return res.status(404).json({ error: "Admin not found." });
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
    const ticket = await SupportTicket.findOne({ ticketRefId });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }
    const user = await User.findOne({ uid: recipientId }).select("email");

    const notification = await createNotification({
      notificationId: generateNotificationId("system"),
      recipientId: recipientId,
      recipientEmail: user?.email,
      category: category || "system",
      actionType: "SUPPORT_TICKET_REPLY",
      title: title || `Update on Ticket #${ticketRefId}`,
      message: message,
      sendEmail: true,
      payload: {
        userName: user?.firstname || "User",
        ticketRefId,
        adminMessage: message,
        date: formattedDate,
        time: formattedTime,
      },
    });
    ticket.status = "pending";
    await ticket.save();
    return res.status(200).json({
      success: true,
      message: "Notification sent and ticket status updated to pending.",
      notification,
      ticket,
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
    const updatedUser = await User.findOneAndUpdate(
      { uid: uid },
      { $set: filteredData },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }
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
      userMetrics,
      liquidityTrendData,
      payoutStats,
      pendingTickets,
      recentSchools,
      recentStations,
      latencyData,
    ] = await Promise.all([
      User.aggregate([
        { $match: { isSuspended: false } },
        {
          $facet: {
            platformTotals: [
              {
                $group: {
                  _id: null,
                  totalLiquidity: { $sum: "$pointsBalance" },
                  totalUsers: { $sum: 1 },
                },
              },
            ],
            locationStats: [
              { $unwind: "$sessions" },
              { $group: { _id: "$sessions.location", count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ]),
      // Inside your controller
      Transactions.aggregate([
        {
          $match: {
            status: "success",
            createdAt: {
              $gte: new Date(new Date().setDate(new Date().getDate() - 7)),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%m-%d", date: "$createdAt" } },
            inFlow: {
              $sum: { $cond: [{ $eq: ["$payType", "in"] }, "$amountLocal", 0] },
            },
            outFlow: {
              $sum: {
                $cond: [{ $eq: ["$payType", "out"] }, "$amountLocal", 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
        {
          $group: {
            _id: null,
            labels: { $push: "$_id" },
            inFlow: { $push: "$inFlow" },
            outFlow: { $push: "$outFlow" },
          },
        },
      ]),
      Payout.aggregate([
        {
          $group: {
            _id: "$status",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      SupportTicket.countDocuments({ status: { $in: ["open", "pending"] } }),
      OperationalInstitutions.find().sort({ createdAt: -1 }).limit(10),

      DropOffStation.find().sort({ createdAt: -1 }).limit(10),
      ControllerLog.aggregate([
        { $group: { _id: null, avgLatency: { $avg: "$latency" } } },
      ]),
    ]);
    const userFacet = userMetrics[0];
    const locationStats = userFacet?.locationStats || [];

    res.json({
      activeUsers: userFacet?.platformTotals[0]?.totalUsers || 0,
      platformLiquidity: userFacet?.platformTotals[0]?.totalLiquidity || 0,
      payoutStats,
      pendingTickets,
      recentSchools: {
        items: recentSchools,
        total: await OperationalInstitutions.countDocuments(),
      },
      recentStations: {
        items: recentStations,
        total: await DropOffStation.countDocuments(),
      },
      latencyData: latencyData[0]?.avgLatency || 0,
      liquidityTrend: liquidityTrendData[0] || {
        labels: [],
        inFlow: [],
        outFlow: [],
      },
      locationStats: locationStats,
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard metrics" });
  }
};
export const getInstitutions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const institutions = await OperationalInstitutions.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json(institutions);
  } catch (error) {
    console.error("Get Institutions Error:", error);
    res.status(500).json({ message: "Failed to retrieve institutions" });
  }
};
export const getDropOffStations = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const stations = await DropOffStation.find()
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json(stations);
  } catch (error) {
    console.error("Get Drop-Off Stations Error:", error);
    res.status(500).json({ message: "Failed to retrieve drop-off stations" });
  }
};
export const deleteInstitution = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await OperationalInstitutions.findOneAndDelete({ id: id });

    if (!result)
      return res.status(404).json({ message: "Institution not found." });

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
    const { id } = req.params;
    const station = await DropOffStation.findOneAndDelete({ id: id });

    if (!station)
      return res.status(404).json({ message: "Drop-off station not found." });

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

    const newInstitution = await OperationalInstitutions.create({
      id: schoolId,
      schoolName,
      contactEmail,
      schoolCode: schoolId,
      logo,
    });

    await SchoolConfiguration.create({
      schoolId,
      name: schoolName,
      countryCode,
      domainWhitelist,
      isOperational,
      verificationMethod,
      externalApiConfig,
      ssoConfig,
    });

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
    const welcomePost = await Posts.create({
      postId: newPostId,
      originalAuthor: adminUserId,
      priorityScore: 10,
      media: {
        url: logo,
        mediaType: "image",
      },
      content: `Welcome to iCampus, ${schoolName}! Students and lecturers from this institution can now sign up and join our community.`,
      postType: "media",
    });

    if (req.io) {
      req.io.emit("new_post", welcomePost);
    }

    res.status(201).json({ success: true, institution: newInstitution });
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

    const updatedSchool = await OperationalInstitutions.findOneAndUpdate(
      { id: id },
      {
        schoolName: updateData.name,
        contactEmail: updateData.contactEmail,
        logo: updateData.logo,
      },
      { new: true },
    );
    const updatedConfig = await SchoolConfiguration.findOneAndUpdate(
      { schoolId: id },
      {
        name: updateData.name,
        countryCode: updateData.countryCode,
        domainWhitelist: updateData.domainWhitelist,
        isOperational: updateData.isOperational,
        verificationMethod: updateData.verificationMethod,
        ssoConfig: updateData.ssoConfig,
        externalApiConfig: updateData.externalApiConfig,
      },
      { new: true },
    );

    if (!updatedSchool || !updatedConfig) {
      return res.status(404).json({ message: "Institution not found." });
    }
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

    res.status(200).json({ success: true, data: updatedSchool });
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
    const newStation = await DropOffStation.create({
      id: stationId,
      name,
      address,
      contactPerson,
      latitude,
      longitude,
      agentId,
      images,
    });
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
    res.status(201).json({ success: true, station: newStation });
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

    const updatedStation = await DropOffStation.findOneAndUpdate(
      { id: id },
      { $set: updateData },
      { new: true },
    );

    if (!updatedStation) {
      return res
        .status(404)
        .json({ success: false, message: "Station not found." });
    }

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

  const studentCount = await User.countDocuments({
    schoolCode: schoolId,
    role: "student",
  });
  const lecturerCount = await User.countDocuments({
    schoolCode: schoolId,
    role: "lecturer",
  });
  const school = await OperationalInstitutions.findOne({
    schoolCode: schoolId,
  });

  res.json({
    schoolName: school.schoolName,
    contactEmail: school.contactEmail,
    logo: school.logo,
    studentCount,
    lecturerCount,
  });
};
export const getStationDetails = async (req, res) => {
  const { stationId } = req.params;

  try {
    const station = await DropOffStation.findOne({ id: stationId });
    if (!station) return res.status(404).json({ message: "Station not found" });
    const agent = await User.findOne({ id: station.agentId });
    res.json({
      stationName: station.name,
      address: station.address,
      agent: agent
        ? {
            firstname: agent.firstName,
            lastname: agent.lastName,
            username: agent.username,
            profilePic: agent.profilePic,
            tier: agent.tier,
            isVerified: agent.isVerified,
            organizationName: agent.organizationName,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};