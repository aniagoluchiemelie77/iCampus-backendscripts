import { Admin, SupportTicket, User } from "../tableDeclarations.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { createNotification } from "../services/notifications.js";
import { generateNotificationId } from "../utils/idGenerator.js";

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
        category: "security",
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
        category: "security",
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
        category: "auth",
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
        category: "profile",
        actionType: "PROFILE_UPDATED",
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
          category: "security",
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
