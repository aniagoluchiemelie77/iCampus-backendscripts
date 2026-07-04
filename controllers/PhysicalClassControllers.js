import { Lectures, User, Attendance } from "../tableDeclarations.js";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const registerAttendanceHandlers = (io, socket) => {
  socket.on("start_attendance_session", async (payload) => {
    const startTime = Date.now();
    const controllerName = "physicalClassAttendanceScannerController";
    const action = "physicalClassAttendanceScanner";
    try {
      const { lectureId, lecturerId } = payload;
      if (!lectureId || !lecturerId) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Malformed attendance payload parameters.",
        );
        socket.emit("error_response", {
          action: "start_attendance_session",
          message: "Malformed attendance payload parameters.",
        });
        return;
      }
      const attendanceRoomId = `lecture_attendance_${lectureId}`;
      await socket.join(attendanceRoomId);
      console.log(
        `[ATTENDANCE_ENGINE] Lecturer ${lecturerId} started session room: ${attendanceRoomId}`,
      );
      await Lectures.findOneAndUpdate(
        { id: lectureId },
        { $set: { attendanceOpen: true } },
      );
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(attendanceRoomId).emit("attendance_session_started", {
        lectureId,
        status: "fetching",
        startedAt: new Date(),
      });
    } catch (error) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to initialize attendance channel:",
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
        action: "start_attendance_session",
        message:
          "Internal server breakdown initializing attendance validation pipe.",
      });
    }
  });
  socket.on("end_attendance_session", async (payload) => {
    const startTime = Date.now();
    const controllerName = "physicalClassEndAttendanceController";
    const action = "physicalClassEndAttendance";
    try {
      const { lectureId } = payload;

      if (!lectureId) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Missing target lecture identifying signature.",
        );
        socket.emit("error_response", {
          action: "end_attendance_session",
          message: "Missing target lecture identifying signature.",
        });
        return;
      }

      const attendanceRoomId = `lecture_attendance_${lectureId}`;

      console.log(
        `[ATTENDANCE_ENGINE] Closing session room: ${attendanceRoomId}`,
      );
      await Lectures.findOneAndUpdate(
        { id: lectureId },
        { $set: { attendanceOpen: false } },
      );
      logControllerPerformance(controllerName, action, startTime, "success");
      io.to(attendanceRoomId).emit("attendance_session_ended", {
        lectureId,
        status: "completed",
        endedAt: new Date(),
      });
      io.in(attendanceRoomId).socketsLeave(attendanceRoomId);
    } catch (error) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to cleanly close attendance channel:",
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
        action: "end_attendance_session",
        message: "Internal server error terminating real-time attendance loop.",
      });
    }
  });
  socket.on("student_mark_attendance", async (payload) => {
    const startTime = Date.now();
    const controllerName = "physicalClassStudentAttendenceConfirmerController";
    const action = "physicalClassStudentAttendenceConfirmer";
    try {
      const { lectureId, studentId, timestamp } = payload;
      if (!lectureId || !studentId) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Invalid check-in parameters provided.",
        );
        return socket.emit("error", "Invalid check-in parameters provided.");
      }
      if (!activeSessions.has(lectureId)) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Attendance session is no longer active.",
        );
        return socket.emit("error", "Attendance session is no longer active.");
      }
      const existingRecord = await Attendance.findOne({ studentId, lectureId });
      if (existingRecord) {
        return socket.emit("attendance_success", {
          message: "Already marked present!",
        });
      }
      const [student, lecture] = await Promise.all([
        User.findOne({ uid: studentId }),
        Lectures.findOne({ id: lectureId }),
      ]);

      if (!student) {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "Student profile record could not be resolved.",
        );
        return socket.emit(
          "error",
          "Student profile record could not be resolved.",
        );
      }
      await Attendance.create({
        studentId,
        lectureId,
        courseId: lecture?.courseId || null,
        status: "Present",
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      });
      const attendanceRoomId = `lecture_attendance_${lectureId}`;

      io.to(attendanceRoomId).emit("student_checked_in", {
        uid: student.uid,
        firstname: student.firstname,
        lastname: student.lastname,
        matricNumber: student.matricNumber,
        department: student.department || "General",
        isException: false,
        timestamp: timestamp,
      });
      logControllerPerformance(controllerName, action, startTime, "success");
      socket.emit("attendance_success", {
        message: "You have been marked present!",
      });

      console.log(
        `[ATTENDANCE_ENGINE] Attendance logged: Student ${student.matricNumber} for Lecture ${lectureId}`,
      );
    } catch (err) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to execute student attendance processing:",
        err.message,
      );
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        err.message,
      );
      socket.emit(
        "error",
        "Internal server failure handling verification pipeline.",
      );
    }
  });
};