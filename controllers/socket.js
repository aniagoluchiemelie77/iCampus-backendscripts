// socket.js
import { Server } from "socket.io";
import { processLecturerAudio } from "./audio-service.js";
import {
  endLecture,
  updateAttendeeList,
  getAttendeesForRoom,
} from "./lectures.js";
import { Deepgram } from "@deepgram/sdk";
let io;
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const activeStreams = new Map();
const activeLectures = {};

const closeStream = (streamKey) => {
  if (activeStreams.has(streamKey)) {
    const stream = activeStreams.get(streamKey);
    stream.finish(); // Tell Deepgram we are done
    activeStreams.delete(streamKey);
    console.log(`Closed stream: ${streamKey}`);
  }
};
module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: "*", // Adjust this for production security
        methods: ["GET", "POST"],
      },
    });

    io.on("connection", (socket) => {
      console.log("A user connected:", socket.id);

      // Listen for a custom 'join' event from the frontend
      socket.on("join_user_room", (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their private room.`);
      });

      socket.on("send_wave", (data) => {
        io.to(data.lectureId).emit("student_waved", {
          firstName: data.firstName,
        });
      });

      socket.on("send_message", (messageData) => {
        // Relay the message to everyone in the room
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
      socket.on("grant_mic_permission", (data) => {
        const room = `lecture_${data.lectureId}`;
        io.to(room).emit("mic_permission_revoked");
        io.to(room).emit("mic_permission_granted", {
          targetUid: data.targetUid, // Changed from studentUid to match frontend
        });
      });
      socket.on("revoke_all_mics", ({ lectureId }) => {
        io.to(`lecture_${lectureId}`).emit("mic_permission_revoked");
      });
      socket.on("student_audio_chunk", (data) => {
        const { lectureId, audio } = data;
        const streamKey = `${lectureId}_${socket.id}`;

        // 1. If we don't have a live AI stream for this student, create one
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
              // 2. Broadcast the text back to the whole class
              io.to(lectureId).emit("transcription_update", {
                text,
                speakerName: socket.userFirstName, // Attach name from socket session
              });
            }
          });

          activeStreams.set(streamKey, dgStream);
        }

        // 3. Push the raw audio chunk (buffer) into the AI stream
        const audioBuffer = Buffer.from(audio, "base64");
        activeStreams.get(streamKey).send(audioBuffer);
      });
      socket.on("end_lecture", async ({ lectureId }) => {
        await endLecture(lectureId);
        io.to(`lecture_${lectureId}`).emit("lecture_ended", { lectureId });
      });
      socket.on("join_lecture", ({ lectureId, user }) => {
        const roomName = `lecture_${lectureId}`;
        socket.join(roomName);

        // 1. Attendance Logic
        updateAttendeeList(lectureId, user, "join");
        const currentAttendees = getAttendeesForRoom(lectureId);

        // Sync the attendee list for everyone in the room
        io.to(roomName).emit("update_attendee_list", currentAttendees);

        // 2. Stream Persistence Logic (for Late Joiners)
        // Check if the lecturer has already registered a stream URL
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

        // Save to memory so joiners can find it
        activeLectures[lectureId] = { ...activeLectures[lectureId], streamUrl };

        // Broadcast to existing users
        io.to(roomName).emit("stream_received", { streamUrl });
      });
      socket.on("webrtc_signal", ({ lectureId, signal, targetUid }) => {
        const roomName = `lecture_${lectureId}`;

        if (targetUid) {
          // 1. Student -> Lecturer (Targeted)
          // We add 'from: socket.id' so the lecturer knows who is answering
          io.to(targetUid).emit("webrtc_signal", {
            signal,
            from: socket.id,
          });
        } else {
          // 2. Lecturer -> All Students (Broadcast)
          // Use socket.to(room).emit to send to everyone EXCEPT the sender
          socket.to(roomName).emit("webrtc_signal", {
            signal,
            from: socket.id,
          });
        }
      });

      socket.on("disconnect", () => {
        for (const [key, value] of activeStreams.entries()) {
          if (key.includes(socket.id)) {
            closeStream(key);
          }
        }
        console.log("User disconnected");
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error("Socket.io not initialized!");
    }
    return io;
  },
};