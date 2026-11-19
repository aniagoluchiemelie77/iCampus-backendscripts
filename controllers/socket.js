// socket.js
import { Server } from "socket.io";
import {
  registerLectureStreamHandlers,
  registerWebRTCSignalingHandlers,
  registerAudioControlHandlers,
  registerScreenShareHandlers,
  registerScreenShareStopHandlers,
  registerChatHandlers,
  registerNetworkFallbackHandlers,
  registerStudentInteractionHandlers,
  registerSpeakerTrackingHandlers,
  registerAttendanceTrackingHandlers,
  registerLectureLifecycleHandlers,
  registerPermissionRequestsHandlers,
  registerMuteAllHandler,
  registerStudentLifecycleHandlers,
  registerLecturerMediaControlHandlers,
} from "./liveClassControllers.js";
import { registerAttendanceHandlers } from "./PhysicalClassControllers.js";
import { resolveAuthUser } from "../middleware/auth.js";
import { corsOrigin, socketCameThroughEdge } from "../middleware/security.js";

let io;

export const init = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
    },
    // Chat and signalling payloads are small; refuse oversized frames.
    maxHttpBufferSize: 1e6,
  });

  // Every connection must present a valid access token (the same one the app
  // sends as "Authorization: Bearer"). The verified account is stored on
  // socket.data.user and handlers trust it, never ids sent in payloads.
  io.use(async (socket, next) => {
    if (!socketCameThroughEdge(socket.handshake.headers)) {
      return next(new Error("forbidden"));
    }
    const header = socket.handshake.headers?.authorization || "";
    const token =
      socket.handshake.auth?.token ||
      (header.startsWith("Bearer ") ? header.slice(7) : null);
    if (!token) return next(new Error("unauthorized"));
    try {
      const user = await resolveAuthUser(String(token));
      if (!user) return next(new Error("unauthorized"));
      socket.data.user = user;
      return next();
    } catch {
      // Clients refresh their token and reconnect on this message.
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const authUid = String(socket.data.user.uid);
    console.log("A user connected:", socket.id);
    // Personal room named by uid: services/notification.js and the live-class
    // "lecture_started" ping emit to io.to(uid). Only the authenticated
    // user's own room: a client-supplied id would let anyone read someone
    // else's notifications. join_room / join_user_room are older aliases and
    // ignore the id they are given.
    socket.join(authUid);
    const joinPersonalRoom = () => {
      socket.join(authUid);
    };
    socket.on("join_room", joinPersonalRoom);
    socket.on("join_user_room", joinPersonalRoom);

    registerStudentInteractionHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerNetworkFallbackHandlers(io, socket);
    registerSpeakerTrackingHandlers(io, socket);
    registerAttendanceTrackingHandlers(io, socket);
    registerPermissionRequestsHandlers(io, socket);
    registerMuteAllHandler(io, socket);
    registerLectureLifecycleHandlers(io, socket);
    registerStudentLifecycleHandlers(io, socket);
    registerAudioControlHandlers(io, socket);
    registerLecturerMediaControlHandlers(io, socket);
    registerScreenShareHandlers(io, socket);
    registerScreenShareStopHandlers(io, socket);
    registerLectureStreamHandlers(io, socket);
    registerWebRTCSignalingHandlers(io, socket);

    // Physical Lectures logic
    registerAttendanceHandlers(io, socket);
    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};

