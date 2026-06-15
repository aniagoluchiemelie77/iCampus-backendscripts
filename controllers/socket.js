// socket.js
import { Server } from "socket.io";
import {} from "./audio-service.js";
import { Deepgram } from "@deepgram/sdk";
import { Lectures, User } from "../tableDeclarations.js";
import { calculateStudentIScore } from "../controllers/iScoreController.js";
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
  registerLecturerMediaControlHandlers,
} from "./liveClassControllers.js";
import { registerAttendanceHandlers } from "./PhysicalClassControllers.js";
import { registerPrivateChatHandlers } from "./chatController.js";

let io;
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const activeStreams = new Map();
const activeLectures = {};
const activeSessions = new Map();

const closeStream = (streamKey) => {
  if (activeStreams.has(streamKey)) {
    const stream = activeStreams.get(streamKey);
    stream.finish();
    activeStreams.delete(streamKey);
    console.log(`Closed stream: ${streamKey}`);
  }
};

export const init = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);
    let dgLive = null;
    socket.on("join_user_room", (userId) => {
      socket.join(userId);
      console.log(`User ${userId} joined their private room.`);
    });
    socket.on("join_course_rooms", (courseIds) => {
      if (Array.isArray(courseIds)) {
        courseIds.forEach((id) => {
          const roomName = `course_${id}`;
          socket.join(roomName);
          console.log(`Socket ${socket.id} joined course room: ${roomName}`);
        });
      }
    });
    registerStudentInteractionHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerNetworkFallbackHandlers(io, socket);
    registerSpeakerTrackingHandlers(io, socket);
    registerAttendanceTrackingHandlers(io, socket);
    socket.on("share_transcription_chunk", (payload) => {
      const { lectureId, speakerLabel, text } = payload;
      socket
        .to(`lecture_${lectureId}`)
        .emit("transcription_update", { speakerLabel, text });
    });
    registerPermissionRequestsHandlers(io, socket);
    registerMuteAllHandler(io, socket);
    registerLectureLifecycleHandlers(io, socket);
    socket.on("leave_lecture", ({ lectureId, uid }) => {
      const roomName = `lecture_${lectureId}`;
      socket.leave(roomName);
      updateAttendeeList(lectureId, { uid }, "leave");
      const currentAttendees = getAttendeesForRoom(lectureId);
      io.to(roomName).emit("update_attendee_list", currentAttendees);
    });
    registerAudioControlHandlers(io, socket);
    registerLecturerMediaControlHandlers(io, socket);
    registerScreenShareHandlers(io, socket);
    registerScreenShareStopHandlers(io, socket);
    registerLectureStreamHandlers(io, socket);
    registerWebRTCSignalingHandlers(io, socket);

    // Physical Lectures logic
    registerAttendanceHandlers(io, socket);
    //P2P chat
    registerPrivateChatHandlers(io, socket);
    socket.on("disconnect", () => {
      for (const [key, value] of activeStreams.entries()) {
        if (key.includes(socket.id)) closeStream(key);
      }
      console.log("User disconnected");
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};