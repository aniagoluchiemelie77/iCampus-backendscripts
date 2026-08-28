import { SupportTicket, User } from "../tableDeclarations.js";
import { createNotification } from "../services/notification.js";
import {
  generateTicketRefId,
  generateNotificationId,
} from "../utils/idGenerator.js";
import { notifyAdmins } from "../services/adminNotification.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";

export const createTicket = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "createTicketController";
  const action = "createTicket";

  try {
    const { message, category } = req.body;
    const userId = req.user?.uid || req.user?.id;

    if (!userId) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Unauthorized user identifier",
      );
      return res.status(401).json({ error: "Unauthorized user identifier" });
    }

    if (!message || !category) {
      return res.status(400).json({ error: "Missing required ticket fields." });
    }

    const ticketRefId =
      typeof generateTicketRefId === "function"
        ? generateTicketRefId("technical")
        : `TKT-${Date.now()}`;
    const now = new Date();

    const newTicketData = {
      ticketRefId,
      userId,
      source: "in-app",
      originalMessage: message,
      severity: "high",
      category,
      thread: [{ sender: userId, message, timestamp: now }],
      createdAt: now,
      updatedAt: now,
    };
    await SupportTicket.doc(ticketRefId).set(newTicketData);
    res.status(200).json(newTicketData);
    setImmediate(() => {
      Promise.all([
        typeof createNotification === "function"
          ? createNotification({
              recipientId: userId,
              category: "system",
              actionType: "SUPPORT_TICKET_RECEIVED",
              sendEmail: true,
              recipientEmail: req.user?.email,
              payload: {
                userName: req.user?.name || "User",
                ticketRefId,
                date: now.toLocaleDateString(),
                time: now.toLocaleTimeString(),
              },
            }).catch((err) => console.error("Ticket notification error:", err))
          : Promise.resolve(),

        Promise.resolve().then(() => {
          if (typeof logControllerPerformance === "function") {
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            );
          }
        }),
      ]);
    });
  } catch (error) {
    console.error("Create Ticket Error:", error.message);
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res.status(500).json({ error: "Failed to create ticket" });
  }
};

export const adminUpdateTicketStatus = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "adminUpdateTicketStatusController";
  const action = "adminUpdateTicketStatus";

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
    const now = new Date();
    const updatePayload = {
      status,
      updatedAt: now,
    };
    const [_, userDoc] = await Promise.all([
      ticketDocRef.set(updatePayload, { merge: true }),
      ticketData.userId
        ? User.doc(ticketData.userId).get()
        : Promise.resolve(null),
    ]);

    const updatedTicket = { ...ticketData, ...updatePayload };
    res.status(200).json({
      success: true,
      message: `Ticket marked as ${status}`,
      ticket: updatedTicket,
    });

    setImmediate(() => {
      const userData = userDoc && userDoc.exists ? userDoc.data() : null;
      const dateString = now.toLocaleDateString();
      const timeString = now.toLocaleTimeString();

      const backgroundTasks = [];

      if (status === "resolved") {
        if (typeof createNotification === "function") {
          backgroundTasks.push(
            createNotification({
              notificationId:
                typeof generateNotificationId === "function"
                  ? generateNotificationId("system")
                  : `NOTIF-${Date.now()}`,
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
            }).catch((err) =>
              console.error("Ticket resolution notification error:", err),
            ),
          );
        }

        if (typeof notifyAdmins === "function") {
          backgroundTasks.push(
            notifyAdmins(
              { role: ["super_admin", "support"] },
              {
                notificationId:
                  typeof generateNotificationId === "function"
                    ? generateNotificationId("admin_notification")
                    : `NOTIF-ADM-${Date.now()}`,
                actionType: "SUPPORT_TICKET_RESOLVED_ADMIN",
                sendEmailFlag: false,
                senderId: req.admin?.uid || req.admin?.id,
                payload: {
                  ticketRefId: ticketData.ticketRefId,
                  userId: ticketData.userId,
                  adminId: req.admin?.uid || req.admin?.id,
                },
              },
              false,
            ).catch((err) =>
              console.error("Admin ticket notification error:", err),
            ),
          );
        }
      }

      if (typeof logControllerPerformance === "function") {
        backgroundTasks.push(
          Promise.resolve().then(() =>
            logControllerPerformance(
              controllerName,
              action,
              startTime,
              "success",
            ),
          ),
        );
      }

      Promise.all(backgroundTasks);
    });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    if (typeof logControllerPerformance === "function") {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
    return res
      .status(500)
      .json({ message: "Server error updating ticket", success: false });
  }
};
