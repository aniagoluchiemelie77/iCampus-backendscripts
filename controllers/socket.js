// socket.js
import { Server } from "socket.io";
import { processLecturerAudio } from "./audio-service.js";
import { Deepgram } from "@deepgram/sdk";
let io;
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const activeStreams = new Map();

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
      socket.on("grant_mic_permission", (data) => {
        // 1. First, tell the whole room to mute (safety first)
        io.to(data.lectureId).emit("mic_permission_revoked");

        // 2. Then, target the specific student to unmute
        io.to(data.lectureId).emit("mic_permission_granted", {
          targetUid: data.studentUid,
        });
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