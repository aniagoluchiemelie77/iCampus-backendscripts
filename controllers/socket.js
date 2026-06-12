// socket.js
import { Server } from "socket.io";
import {
  processLecturerAudio,
  startLiveTranscription,
} from "./audio-service.js";
import {
  endLecture,
  updateAttendeeList,
  getAttendeesForRoom,
} from "./lectures.js";
import { Deepgram } from "@deepgram/sdk";
import { Lectures, User, Attendance, Message } from "../tableDeclarations.js";
import { calculateStudentIScore } from "../controllers/iScoreController.js";

let io;
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const activeStreams = new Map();
const activeLectures = {};
const activeSessions = new Map(); // FIXED: Was missing declaration

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

    socket.on("send_wave", (data) => {
      io.to(data.lectureId).emit("student_waved", {
        firstName: data.firstName,
      });
    });

    socket.on("send_message", (messageData) => {
      io.to(messageData.lectureId).emit("receive_message", messageData);
    });

    socket.on("ai_transcription_chunk", (data) => {
      io.to(data.lectureId).emit("transcription_update", {
        text: data.text,
      });
    });

    socket.on("lecturer_audio_chunk", (data) => {
      processLecturerAudio(data.audioBuffer, data.lectureId, io);
    });
    socket.on("start-lecture", () => {
      // Initialize the transcription pipeline
      dgLive = startLiveTranscription(socket, io);
    });

    socket.on("audio-data", (data) => {
      // Send raw audio buffer from React Native to Deepgram
      if (dgLive && dgLive.getReadyState() === 1) {
        dgLive.send(data);
      }
    });

    socket.on("grant_mic_permission", (data) => {
      const room = `lecture_${data.lectureId}`;
      io.to(room).emit("mic_permission_revoked");
      io.to(room).emit("mic_permission_granted", {
        targetUid: data.targetUid,
      });
    });

    socket.on("revoke_all_mics", ({ lectureId }) => {
      io.to(`lecture_${lectureId}`).emit("mic_permission_revoked");
    });

    socket.on("student_audio_chunk", (data) => {
      const { lectureId, audio } = data;
      const streamKey = `${lectureId}_${socket.id}`;

      if (!activeStreams.has(streamKey)) {
        const dgStream = deepgram.transcription.live({
          punctuate: true,
          interim_results: true,
          encoding: "linear16",
          sample_rate: 16000,
        });

        dgStream.addListener("transcriptReceived", (transcription) => {
          const text = transcription.channel.alternatives[0].transcript;
          if (text) {
            io.to(lectureId).emit("transcription_update", {
              text,
              speakerName: socket.userFirstName,
            });
          }
        });
        activeStreams.set(streamKey, dgStream);
      }

      const audioBuffer = Buffer.from(audio, "base64");
      activeStreams.get(streamKey).send(audioBuffer);
    });

    socket.on("end_lecture", async ({ lectureId }) => {
      await endLecture(lectureId);
      io.to(`lecture_${lectureId}`).emit("lecture_ended", { lectureId });
      if (dgLive) dgLive.finish();
    });

    socket.on("join_lecture", ({ lectureId, user }) => {
      const roomName = `lecture_${lectureId}`;
      socket.join(roomName);
      updateAttendeeList(lectureId, user, "join");
      const currentAttendees = getAttendeesForRoom(lectureId);
      io.to(roomName).emit("update_attendee_list", currentAttendees);

      if (activeLectures[lectureId]?.streamUrl) {
        socket.emit("stream_received", {
          streamUrl: activeLectures[lectureId].streamUrl,
        });
      }
      console.log(`User ${user.firstname} joined ${roomName}`);
    });

    socket.on("leave_lecture", ({ lectureId, uid }) => {
      const roomName = `lecture_${lectureId}`;
      socket.leave(roomName);
      updateAttendeeList(lectureId, { uid }, "leave");
      const currentAttendees = getAttendeesForRoom(lectureId);
      io.to(roomName).emit("update_attendee_list", currentAttendees);
    });

    socket.on("toggle_lecturer_mic", ({ lectureId, isMuted }) => {
      io.to(`lecture_${lectureId}`).emit("lecturer_mic_toggled", { isMuted });
    });

    socket.on("toggle_lecturer_camera", ({ lectureId, isCameraOn }) => {
      io.to(`lecture_${lectureId}`).emit("lecturer_camera_toggled", {
        isCameraOn,
      });
    });

    socket.on("lecturer_started_sharing", ({ lectureId, streamId }) => {
      io.to(`lecture_${lectureId}`).emit("lecturer_started_sharing", {
        streamId,
      });
    });

    socket.on("lecturer_stopped_sharing", ({ lectureId }) => {
      io.to(`lecture_${lectureId}`).emit("lecturer_stopped_sharing");
    });

    socket.on("stream_ready", ({ lectureId, streamUrl }) => {
      const roomName = `lecture_${lectureId}`;
      activeLectures[lectureId] = { ...activeLectures[lectureId], streamUrl };
      io.to(roomName).emit("stream_received", { streamUrl });
    });

    socket.on("webrtc_signal", ({ lectureId, signal, targetUid }) => {
      const roomName = `lecture_${lectureId}`;
      if (targetUid) {
        io.to(targetUid).emit("webrtc_signal", { signal, from: socket.id });
      } else {
        socket.to(roomName).emit("webrtc_signal", { signal, from: socket.id });
      }
    });

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

    socket.on("disconnect", () => {
      for (const [key, value] of activeStreams.entries()) {
        if (key.includes(socket.id)) closeStream(key);
      }
      console.log("User disconnected");
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
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialized!");
  return io;
};