import { Message, Notification } from "../tableDeclarations.js";
import { db } from "../config/firebaseAdmin.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const registerPrivateChatHandlers = (io, socket) => {
  socket.on("join_chat", async (payload) => {
    const startTime = Date.now();
    const controllerName = "startChatController";
    const action = "startChat";
    try {
      const { roomId } = payload;
      if (!roomId) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Target channel tracking signature missing.",
        );
        return socket.emit("error_response", {
          action: "join_chat",
          message: "Target channel tracking signature missing.",
        });
      }
      logControllerPerformance(controllerName, action, startTime, "success");
      await socket.join(roomId);
      console.log(
        `[CHAT_ENGINE] Socket ${socket.id} locked into private room: ${roomId}`,
      );
    } catch (error) {
      console.error("[CHAT_ERROR] Room orchestration failure:", error.message);
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
  });
  socket.on("send_private_message", async (payload) => {
    const startTime = Date.now();
    const controllerName = "sendMessageController";
    const action = "sendMessage";
    try {
      const { id, text, senderId, recipientId, attachments } = payload;
      if (
        !senderId ||
        !recipientId ||
        (!text?.trim() && !attachments?.length)
      ) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Message payload contains incomplete parameters.",
        );
        return socket.emit("error_response", {
          action: "send_private_message",
          message: "Message payload contains incomplete parameters.",
        });
      }
      const roomId = [senderId, recipientId].sort().join("_");
      const messageId = id || `msg_${Date.now()}`;

      const dbMessagePayload = {
        messageId,
        senderId,
        recipientId,
        text: text?.trim() || "",
        attachments: attachments || [],
        status: "sent",
        timestamp: new Date(),
      };
      Message.doc(messageId)
        .set(dbMessagePayload)
        .catch((dbErr) => {
          console.error(
            `[CHAT_DB_ERROR] Message writing failed for ${messageId}:`,
            dbErr.message,
          );
        });
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(roomId).emit("receive_message", {
        id: messageId,
        text: dbMessagePayload.text,
        senderId: dbMessagePayload.senderId,
        recipientId: dbMessagePayload.recipientId,
        attachments: dbMessagePayload.attachments,
        status: dbMessagePayload.status,
        timestamp: dbMessagePayload.timestamp.toISOString(),
      });
    } catch (error) {
      console.error(
        "[CHAT_ERROR] Message routing operation dropped:",
        error.message,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
      socket.emit("error_response", {
        action: "send_private_message",
        message: "Internal server breakdown executing transmission pipelines.",
      });
    }
  });
  socket.on("msg_delivered", async (payload) => {
    const startTime = Date.now();
    const controllerName = "markMessageAsDeliveredController";
    const action = "markMessageAsDelivered";
    try {
      const { messageId, senderId } = payload;
      if (!messageId || !senderId) return;
      const roomId = [socket.handshake.query.userId, senderId].sort().join("_");
      const messageQuery = await Message.where("messageId", "==", messageId)
        .limit(1)
        .get();
      if (!messageQuery.empty) {
        const messageDocRef = messageQuery.docs[0].ref;
        messageDocRef
          .set(
            {
              status: "delivered",
              updatedAt: new Date(),
            },
            { merge: true },
          )
          .catch(() => {});
      }
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(roomId).emit("status_update", {
        messageId,
        status: "delivered",
      });
    } catch (error) {
      console.error(
        "[CHAT_ERROR] Delivery receipt acknowledgment exception:",
        error.message,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
  });
  socket.on("mark_as_seen", async (payload) => {
    const startTime = Date.now();
    const controllerName = "markMessageAsSeenController";
    const action = "markMessageAsSeen";
    try {
      const { readerId, senderId } = payload;
      if (!readerId || !senderId) return;
      const roomId = [readerId, senderId].sort().join("_");
      (async () => {
        const unseenSnapshot = await Message.where("senderId", "==", senderId)
          .where("recipientId", "==", readerId)
          .where("status", "!=", "seen")
          .get();

        if (!unseenSnapshot.empty) {
          const batch = db.batch();
          const now = new Date();

          unseenSnapshot.docs.forEach((doc) => {
            batch.update(doc.ref, {
              status: "seen",
              updatedAt: now,
            });
          });

          await batch.commit();
        }
      })().catch((dbErr) => {
        console.error(
          "[CHAT_DB_ERROR] Massive read state flag execution failure:",
          dbErr.message,
        );
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          dbErr.message,
        );
      });
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(roomId).emit("messages_seen", { readerId });
    } catch (error) {
      console.error(
        "[CHAT_ERROR] Processing seen status operation dropped:",
        error.message,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        error.message,
      );
    }
  });
  socket.on("edit_message", ({ messageId, newText, recipientId }) => {
    const roomId = [socket.userId, recipientId].sort().join("_");

    socket.to(roomId).emit("message_edited", {
      messageId,
      newText,
    });
  });
  socket.on("delete_message", ({ messageId, recipientId }) => {
    const roomId = [socket.userId, recipientId].sort().join("_");

    socket.to(roomId).emit("message_deleted", {
      messageId,
    });
  });
};
export const markAllMessagesAsRead = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "markAllMessagesAsReadController";
  const action = "markAllMessagesAsRead";
  try {
    const userId = req.user.id;
    const unseenSnapshot = await Message.where("recipientId", "==", userId)
      .where("status", "!=", "seen")
      .get();
    if (!unseenSnapshot.empty) {
      const batch = db.batch();
      const now = new Date();

      unseenSnapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
          status: "seen",
          updatedAt: now,
        });
      });

      await batch.commit();
    }
    logControllerPerformance(controllerName, action, startTime, "success");
    res.json({ success: true });
  } catch (err) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ error: err.message, success: false });
  }
};
export const editMessage = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "editMessageController";
  const action = "editMessage";
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const senderId = req.user.uid;

    const snapshot = await Message.where("messageId", "==", messageId)
      .where("senderId", "==", senderId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Message not found or unauthorized",
      );
      return res
        .status(404)
        .json({ message: "Message not found or unauthorized" });
    }

    const messageDocRef = snapshot.docs[0].ref;
    const existingData = snapshot.docs[0].data();
    const updatePayload = {
      text: text?.trim(),
      isEdited: true,
      updatedAt: new Date(),
    };
    await messageDocRef.set(updatePayload, { merge: true });
    const updatedMessage = {
      ...existingData,
      ...updatePayload,
    };
    logControllerPerformance(controllerName, action, startTime, "success");

    res.status(200).json({ success: true, message: updatedMessage });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Server error" });
  }
};
export const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const senderId = req.user.uid;

    const snapshot = await Message.where("messageId", "==", messageId)
      .where("senderId", "==", senderId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "Message not found or unauthorized",
      );
      return res
        .status(404)
        .json({ message: "Message not found or unauthorized" });
    }

    const messageDocRef = snapshot.docs[0].ref;
    await messageDocRef.set(
      {
        status: "deleted",
        text: "This message was deleted",
        updatedAt: new Date(),
      },
      { merge: true },
    );

    logControllerPerformance(controllerName, action, startTime, "success");
    res.status(200).json({ success: true });
  } catch (error) {
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    res.status(500).json({ message: "Server error" });
  }
};
