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

    const newTicket = await SupportTicket.create({
      userId,
      ticketRefId: generateTicketRefId("technical"),
      source: "in-app",
      originalMessage: message,
      severity: "high",
      category,
      thread: [{ sender: userId, message }],
    });
    await createNotification({
      recipientId: userId,
      category: "system",
      actionType: "SUPPORT_TICKET_RECEIVED",
      sendEmail: true,
      recipientEmail: req.user.email,
      payload: {
        userName: req.user.name,
        ticketRefId: newTicket.ticketRefId,
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
      },
    });

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(201).json(newTicket);
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

    const ticket = await SupportTicket.findOne({ ticketRefId });
    if (!ticket) {
      return res
        .status(404)
        .json({ message: "Ticket not found", success: false });
    }

    ticket.status = status;
    await ticket.save();

    if (status === "resolved") {
      const user = await User.findOne({ uid: ticket.userId }).select(
        "firstname email",
      );

      const now = new Date();
      const dateString = now.toLocaleDateString();
      const timeString = now.toLocaleTimeString();
      await Promise.all([
        createNotification({
          notificationId: generateNotificationId("system"),
          recipientId: ticket.userId,
          recipientEmail: user?.email,
          category: "system",
          actionType: "SUPPORT_TICKET_RESOLVED",
          sendEmail: true,
          payload: {
            userName: user?.firstname || "User",
            ticketRefId: ticket.ticketRefId,
            date: dateString,
            time: timeString,
          },
        }),
        notifyAdmins(
          { role: ["super_admin", "support"] },
          {
            notificationId: generateNotificationId("system"),
            category: "system",
            actionType: "SUPPORT_TICKET_RESOLVED_ADMIN",
            sendEmailFlag: false,
            senderId: req.admin.uid,
            payload: {
              ticketRefId: ticket.ticketRefId,
              userId: ticket.userId,
              adminId: req.admin.uid,
            },
          },
        ),
      ]);
    }
    res.status(200).json({
      success: true,
      message: `Ticket marked as ${status}`,
      ticket,
    });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    res
      .status(500)
      .json({ message: "Server error updating ticket", success: false });
  }
};
