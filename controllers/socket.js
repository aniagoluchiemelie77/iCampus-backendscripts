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

let io;

export const init = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    // Personal room named by uid: services/notification.js and the live-class
    // "lecture_started" ping emit to io.to(uid). Clients pass userId in the
    // handshake query; join_room / join_user_room are older client aliases.
    const handshakeUid = socket.handshake.query?.userId;
    if (handshakeUid && handshakeUid !== "undefined") {
      socket.join(String(handshakeUid));
    }
    const joinPersonalRoom = (uid) => {
      if (uid) socket.join(String(uid));
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

