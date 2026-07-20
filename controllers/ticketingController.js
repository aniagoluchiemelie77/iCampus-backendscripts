import { SupportTicket, User } from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import {
  generateTicketRefId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const createTicket = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createTicketController";
  const action = "createTicket";

  try {
    const { message, category } = req.body;
    const userId = req.user.uid;

    const ticketRefId = generateTicketRefId("technical");

    const newTicketData = {
      ticketRefId,
      userId,
      source: "in-app",
      originalMessage: message,
      severity: "high",
      category,
      thread: [{ sender: userId, message, timestamp: new Date() }],
      createdAt: new Date(),
    };
    await SupportTicket.doc(ticketRefId).set(newTicketData);

    await createNotification({
      recipientId: userId,
      category: "system",
      actionType: "SUPPORT_TICKET_RECEIVED",
      sendEmail: true,
      recipientEmail: req.user.email,
      payload: {
        userName: req.user.name,
        ticketRefId,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
      },
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json(newTicketData);
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: "Failed to create ticket" });
  }
};
export const adminUpdateTicketStatus = async (req, res) => {
  try {
    const { ticketRefId } = req.params;
    const { status } = req.body;

    if (!status) {
      return res
        .status(400)
        .json({ message: "Status is required", success: false });
    }

    const ticketSnapshot = await SupportTicket.where(
      "ticketRefId",
      "==",
      ticketRefId,
    )
      .limit(1)
      .get();

    if (ticketSnapshot.empty) {
      return res
        .status(404)
        .json({ message: "Ticket not found", success: false });
    }

    const ticketDocRef = ticketSnapshot.docs[0].ref;
    const ticketData = ticketSnapshot.docs[0].data();
    const updatePayload = {
      status,
      updatedAt: new Date(),
    };
    await ticketDocRef.set(updatePayload, { merge: true });

    const updatedTicket = { ...ticketData, ...updatePayload };

    if (status === "resolved") {
      let userData = null;
      if (ticketData.userId) {
        const userDoc = await User.doc(ticketData.userId).get();
        if (userDoc.exists) {
          userData = userDoc.data();
        }
      }

      const now = new Date();
      const dateString = now.toLocaleDateString();
      const timeString = now.toLocaleTimeString();
      await Promise.all([
        createNotification({
          notificationId: generateNotificationId("system"),
          recipientId: ticketData.userId,
          recipientEmail: userData?.email,
          category: "system",
          actionType: "SUPPORT_TICKET_RESOLVED",
          sendEmail: true,
          payload: {
            userName: userData?.firstname || "User",
            ticketRefId: ticketData.ticketRefId,
            date: dateString,
            time: timeString,
          },
        }),
        notifyAdmins(
          { role: ["super_admin", "support"] },
          {
            notificationId: generateNotificationId("admin_notification"),
            actionType: "SUPPORT_TICKET_RESOLVED_ADMIN",
            sendEmailFlag: false,
            senderId: req.admin.uid,
            payload: {
              ticketRefId: ticketData.ticketRefId,
              userId: ticketData.userId,
              adminId: req.admin.uid,
            },
          },
          false,
        ),
      ]);
    }
    res.status(200).json({
      success: true,
      message: `Ticket marked as ${status}`,
      ticket: updatedTicket,
    });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    res
      .status(500)
      .json({ message: "Server error updating ticket", success: false });
  }
};
