import { Lectures, User, Attendance } from "../tableDeclarations.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";

export const registerAttendanceHandlers = (io, socket) => {
  socket.on("start_attendance_session", async (payload) => {
    const startTime = Date.now();
    const controllerName = "physicalClassAttendanceScannerController";
    const action = "physicalClassAttendanceScanner";

    try {
      const { lectureId, lecturerId } = payload || {};
      if (!lectureId || !lecturerId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed attendance payload parameters.",
          );
        });
        socket.emit("error_response", {
          action: "start_attendance_session",
          message: "Malformed attendance payload parameters.",
        });
        return;
      }

      const attendanceRoomId = `lecture_attendance_${lectureId}`;
      const startedAt = new Date();
      await Promise.all([
        socket.join(attendanceRoomId),
        (async () => {
          const lectureQuery = await Lectures.where("id", "==", lectureId)
            .limit(1)
            .get();
          if (!lectureQuery.empty) {
            await lectureQuery.docs[0].ref.update({
              attendanceOpen: true,
              updatedAt: new Date(),
            });
          } else {
            const lectureDocRef = Lectures.doc(lectureId);
            const lectureDoc = await lectureDocRef.get();
            if (lectureDoc.exists) {
              await lectureDocRef.update({
                attendanceOpen: true,
                updatedAt: new Date(),
              });
            }
          }
        })(),
      ]);

      console.log(
        `[ATTENDANCE_ENGINE] Lecturer ${lecturerId} started session room: ${attendanceRoomId}`,
      );
      io.to(attendanceRoomId).emit("attendance_session_started", {
        lectureId,
        status: "fetching",
        startedAt,
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } catch (error) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to initialize attendance channel:",
        error.message,
      );
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          error.message,
        );
      });
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
      const { lectureId } = payload || {};
      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Missing target lecture identifying signature.",
          );
        });
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
      const endedAt = new Date();
      const lectureQuery = await Lectures.where("id", "==", lectureId)
        .limit(1)
        .get();
      if (!lectureQuery.empty) {
        await lectureQuery.docs[0].ref.update({
          attendanceOpen: false,
          updatedAt: new Date(),
        });
      } else {
        const lectureDocRef = Lectures.doc(lectureId);
        const lectureDoc = await lectureDocRef.get();
        if (lectureDoc.exists) {
          await lectureDocRef.update({
            attendanceOpen: false,
            updatedAt: new Date(),
          });
        }
      }

      io.to(attendanceRoomId).emit("attendance_session_ended", {
        lectureId,
        status: "completed",
        endedAt,
      });
      setImmediate(() => {
        try {
          io.in(attendanceRoomId).socketsLeave(attendanceRoomId);
        } catch (err) {
          console.error("Background socket leave error:", err);
        }
      });
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } catch (error) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to cleanly close attendance channel:",
        error.message,
      );
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          error.message,
        );
      });
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
      const { lectureId, studentId, timestamp } = payload || {};
      if (!lectureId || !studentId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Invalid check-in parameters provided.",
          );
        });
        return socket.emit("error", "Invalid check-in parameters provided.");
      }
      if (
        typeof activeSessions !== "undefined" &&
        activeSessions instanceof Map &&
        !activeSessions.has(lectureId)
      ) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Attendance session is no longer active.",
          );
        });
        return socket.emit("error", "Attendance session is no longer active.");
      }
      const [existingRecordQuery, studentQuery, lectureQuery] =
        await Promise.all([
          Attendance.where("studentId", "==", studentId)
            .where("lectureId", "==", lectureId)
            .limit(1)
            .get(),
          User.where("uid", "==", studentId).limit(1).get(),
          Lectures.where("id", "==", lectureId).limit(1).get(),
        ]);

      if (!existingRecordQuery.empty) {
        return socket.emit("attendance_success", {
          message: "Already marked present!",
        });
      }

      const student = !studentQuery.empty ? studentQuery.docs[0].data() : null;
      const lecture = !lectureQuery.empty ? lectureQuery.docs[0].data() : null;

      if (!student) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Student profile record could not be resolved.",
          );
        });
        return socket.emit(
          "error",
          "Student profile record could not be resolved.",
        );
      }

      const attendanceId = Math.random().toString(36).slice(2, 11);
      const attendanceRecord = {
        attendanceId,
        studentId,
        lectureId,
        courseId: lecture?.courseId || null,
        status: "Present",
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        createdAt: new Date(),
      };
      await Attendance.doc(attendanceId).set(attendanceRecord);
      const attendanceRoomId = `lecture_attendance_${lectureId}`;
      socket.emit("attendance_success", {
        message: "You have been marked present!",
      });
      setImmediate(() => {
        try {
          io.to(attendanceRoomId).emit("student_checked_in", {
            uid: student.uid,
            firstname: student.firstname,
            lastname: student.lastname,
            matricNumber: student.matricNumber,
            department: student.department || "General",
            isException: false,
            timestamp: timestamp,
          });

          console.log(
            `[ATTENDANCE_ENGINE] Attendance logged: Student ${student.matricNumber} for Lecture ${lectureId}`,
          );
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "success",
          );
        } catch (err) {
          console.error(
            "Background task execution failure in student_mark_attendance:",
            err,
          );
        }
      });
    } catch (err) {
      console.error(
        "[ATTENDANCE_ENGINE_ERROR] Failed to execute student attendance processing:",
        err.message,
      );
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          err.message,
        );
      });
      socket.emit(
        "error",
        "Internal server failure handling verification pipeline.",
      );
    }
  });
};

//Tested and trusted using jest