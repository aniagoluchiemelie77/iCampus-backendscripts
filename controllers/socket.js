// socket.js
import { Server } from "socket.io";
import {} from "./audio-service.js";
import { Deepgram } from "@deepgram/sdk";
import { Lectures, User, Attendance, Message } from "../tableDeclarations.js";
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
    socket.on("start_attendance_session", ({ lectureId, lecturerId }) => {
      socket.join(`lecturer_${lectureId}`);
      activeSessions.set(lectureId, {
        startTime: Date.now(),
        lecturerId,
        status: "fetching",
      });
      console.log(`[BLE Verification Link Activated]: ${lectureId}`);
    });
    socket.on(
      "student_mark_attendance",
      async ({ lectureId, studentId, timestamp }) => {
        try {
          if (!activeSessions.has(lectureId)) {
            return socket.emit(
              "error",
              "Attendance session is no longer active.",
            );
          }

          const lecture = await Lectures.findOne({ id: lectureId });

          // 1. Prevent multiple attendance entries for same lecture/student
          const existing = await Attendance.findOne({ studentId, lectureId });
          if (existing) {
            return socket.emit("attendance_success", {
              message: "Already marked present!",
            });
          }

          // 2. Create Attendance Record
          await Attendance.create({
            studentId,
            lectureId,
            courseId: lecture?.courseId,
            status: "Present",
            timestamp: new Date(),
          });

          // 3. Optional: Trigger Lecturer UI Update
          const student = await User.findOne({ uid: studentId });
          io.to(`lecturer_${lectureId}`).emit("student_checked_in", {
            uid: student.uid,
            firstname: student.firstname,
            lastname: student.lastname,
            matricNumber: student.matricNumber,
            timestamp: timestamp,
          });

          socket.emit("attendance_success", {
            message: "You have been marked present!",
          });
        } catch (err) {
          console.error(err);
        }
      },
    );
    socket.on("end_attendance_session", async ({ lectureId }) => {
      try {
        activeSessions.delete(lectureId);
        await Lectures.findOneAndUpdate(
          { id: lectureId },
          { status: "completed", isTaught: true, getAttendanceMode: "Online" },
        );
        io.to(`lecture_room_${lectureId}`).emit("attendance_closed", {
          message: "Attendance session has ended.",
        });
        socket.leave(`lecturer_${lectureId}`);
      } catch (error) {
        console.error(error);
      }
    });
    //P2P chat
    socket.on("join_chat", ({ roomId }) => {
      socket.join(roomId);
    });
    socket.on("send_private_message", async (data) => {
      try {
        const newMessage = new Message({
          id: data.id, // Your custom frontend ID
          senderId: data.senderId,
          recipientId: data.recipientId,
          text: data.text,
          attachments: data.attachments || [],
          status: "sent",
          timestamp: data.timestamp || new Date(),
        });
        const savedMessage = await newMessage.save();
        const roomId = [data.senderId, data.recipientId].sort().join("_");
        socket.to(roomId).emit("receive_message", savedMessage);
      } catch (error) {
        console.error("Socket Message Save Error:", error);
        socket.emit("message_error", { error: "Message could not be saved" });
      }
    });
    socket.on("msg_delivered", async ({ messageId, senderId }) => {
      try {
        const updatedMsg = await Message.findOneAndUpdate(
          { id: messageId },
          { status: "delivered" },
          { new: true },
        );

        if (updatedMsg) {
          socket.to(senderId).emit("status_update", {
            messageId: messageId,
            status: "delivered",
          });
        }
      } catch (err) {
        console.error("Error updating delivery status:", err);
      }
    });
    socket.on("mark_as_seen", async ({ readerId, senderId }) => {
      await Message.updateMany(
        { senderId: senderId, recipientId: readerId, status: { $ne: "seen" } },
        { $set: { status: "seen" } },
      );
      socket.to(senderId).emit("messages_seen", { readerId });
    });
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