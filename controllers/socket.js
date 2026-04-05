// socket.js
import { Server } from "socket.io";
import { processLecturerAudio } from "./audio-service.js";
let io;

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
      socket.on("join_lecture", (data) => {
        socket.join(data.lectureId);
        console.log(`User joined lecture room: ${data.lectureId}`);
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

      socket.on("disconnect", () => {
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