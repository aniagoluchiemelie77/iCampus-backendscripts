import { Message, Notification } from "../tableDeclarations.js";
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
      const dbMessagePayload = {
        messageId: id || `msg_${Date.now()}`,
        senderId,
        recipientId,
        text: text?.trim(),
        attachments: attachments || [],
        status: "sent",
        timestamp: new Date(),
      };
      Message.create(dbMessagePayload).catch((dbErr) => {
        console.error(
          `[CHAT_DB_ERROR] Message writing failed for ${dbMessagePayload.messageId}:`,
          dbErr.message,
        );
      });
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(roomId).emit("receive_message", {
        id: dbMessagePayload.messageId,
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
    const startTime = Date.now();
    const controllerName = "markMessageAsDeliveredController";
    const action = "markMessageAsDelivered";
    try {
      const { messageId, senderId } = payload;
      if (!messageId || !senderId) return;
      const roomId = [socket.handshake.query.userId, senderId].sort().join("_");
      Message.updateOne({ messageId }, { $set: { status: "delivered" } }).catch(
        () => {},
      );
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
      Message.updateMany(
        { senderId: senderId, recipientId: readerId, status: { $ne: "seen" } },
        { $set: { status: "seen" } },
      ).catch((dbErr) => {
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
};
