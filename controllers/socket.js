// socket.js
import { Server } from "socket.io";

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: "*", // Adjust this for production security
        methods: ["GET", "POST"]
      }
    });

    io.on('connection', (socket) => {
      console.log('A user connected:', socket.id);

      // Listen for a custom 'join' event from the frontend
      socket.on('join_user_room', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their private room.`);
      });

      socket.on('disconnect', () => {
        console.log('User disconnected');
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};