import { Lectures, User, Attendance, Course } from "../tableDeclarations.js";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";
import { createNotification } from "../services/notification.js";
import { generateNotificationId } from "../utils/idGenerator.js";
import { db } from "../config/firebaseAdmin.js";
import {
  BEACON_WINDOW_SECONDS,
  createBeaconSecret,
  isFreshBeaconCode,
  verifyIdentityProof,
} from "../utils/attendanceSecurity.js";

const activeSessions = new Map();

// Beacon secrets live in their own collection, never on the lecture document:
// lectures are returned to students by several endpoints.
const AttendanceSessions = db.collection("attendance_sessions");

// Set ATTENDANCE_REQUIRE_FACE_PROOF=false only as a temporary escape hatch
// while old app versions are still being replaced.
const faceProofRequired = () => process.env.ATTENDANCE_REQUIRE_FACE_PROOF !== "false";

const findCourse = async (courseId) => {
  if (!courseId) return null;
  const snap = await Course.where("courseId", "==", courseId).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
};

/** The lecture's host or one of the course's lecturers. */
const canRunAttendance = (uid, lecture, course) =>
  !!uid &&
  !!lecture &&
  (lecture.hostId === uid ||
    lecture.lecturerId === uid ||
    (Array.isArray(course?.lecturerIds) && course.lecturerIds.includes(uid)));

const isEnrolled = (uid, course) =>
  Array.isArray(course?.studentsEnrolled) && course.studentsEnrolled.includes(uid);

/** Lecture docs are keyed by id, but older ones only have an `id` field. */
const findLectureDoc = async (lectureId) => {
  const direct = await Lectures.doc(String(lectureId)).get();
  if (direct.exists) return direct;
  const query = await Lectures.where("id", "==", lectureId).limit(1).get();
  return query.empty ? null : query.docs[0];
};

/** Push + in-app ping to every enrolled student that attendance is open. */
const notifyStudentsAttendanceOpen = async (io, lecture) => {
  const courseQuery = await Course.where("courseId", "==", lecture.courseId)
    .limit(1)
    .get();
  if (courseQuery.empty) return;
  const course = courseQuery.docs[0].data();
  const studentUids = course.studentsEnrolled || [];
  await Promise.all(
    studentUids.map(async (uid) => {
      // Opens the "lecture ongoing" sheet on Home, which leads to the scanner.
      io.to(String(uid)).emit("lecture_started", lecture);
      try {
        await createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: uid,
          isRead: false,
          category: "classroom",
          actionType: "ATTENDANCE_OPEN",
          title: `Attendance is open: ${course.courseCode || "your class"}`,
          message: `Tap to mark your attendance for "${lecture.topicName}"${lecture.location ? ` at ${lecture.location}` : ""}.`,
          payload: {
            lectureId: lecture.id,
            courseId: lecture.courseId,
            topicName: lecture.topicName,
            location: lecture.location,
            lectureType: lecture.lectureType || "Physical",
          },
          entityId: lecture.id,
          entityType: "lecture",
          sendPush: true,
          sendSocket: true,
          saveToDb: true,
        });
      } catch (err) {
        console.error(`[ATTENDANCE_ENGINE] notify ${uid} failed:`, err.message);
      }
    }),
  );
};

export const registerAttendanceHandlers = (io, socket) => {
  socket.on("start_attendance_session", async (payload) => {
    const startTime = Date.now();
    const controllerName = "physicalClassAttendanceScannerController";
    const action = "physicalClassAttendanceScanner";

    try {
      const { lectureId, beaconVersion } = payload || {};
      // Who is asking comes from the authenticated socket, not the payload.
      const lecturerId = socket.data?.user?.uid;
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
      const lectureDoc = await findLectureDoc(lectureId);
      const lecture = lectureDoc?.data() || null;
      const course = await findCourse(lecture?.courseId);
      if (!canRunAttendance(lecturerId, lecture, course)) {
        socket.emit("error_response", {
          action: "start_attendance_session",
          message: "Only this lecture's lecturer can take attendance.",
        });
        return;
      }
      await socket.join(attendanceRoomId);
      const wasAlreadyOpen = !!lecture?.attendanceOpen;

      // Rotating beacon (app versions that send beaconVersion >= 2). A
      // reopen/reconnect keeps the same secret so codes students already
      // heard stay valid.
      const sessionRef = AttendanceSessions.doc(String(lectureId));
      if (Number(beaconVersion) >= 2) {
        const existing = wasAlreadyOpen ? (await sessionRef.get()).data() : null;
        const secret = existing?.secret || createBeaconSecret();
        await sessionRef.set({
          lectureId: String(lectureId),
          lecturerId,
          secret,
          windowSeconds: BEACON_WINDOW_SECONDS,
          startedAt,
        });
        // Only to this socket: the secret must never reach students.
        socket.emit("attendance_beacon_config", {
          lectureId,
          secret,
          windowSeconds: BEACON_WINDOW_SECONDS,
          serverTime: Date.now(),
        });
      } else {
        // Older lecturer app with a fixed beacon name: no code to check.
        await sessionRef.delete().catch(() => {});
      }
      if (lectureDoc) {
        await lectureDoc.ref.update({
          attendanceOpen: true,
          // Physical lectures used to stay "scheduled", so students never saw
          // them as ongoing and had no way into the scanner.
          ...(["scheduled", "postponed"].includes(lecture.status) && {
            status: "ongoing",
          }),
          updatedAt: new Date(),
        });
      }
      // Tell enrolled students (push + in-app) so they can check in. Skipped
      // on a reopen/reconnect so they aren't notified twice.
      if (lecture && !wasAlreadyOpen) {
        setImmediate(() =>
          notifyStudentsAttendanceOpen(io, {
            ...lecture,
            id: lecture.id || lectureId,
            status: "ongoing",
            attendanceOpen: true,
          }).catch((err) =>
            console.error("[ATTENDANCE_ENGINE] notify failed:", err.message),
          ),
        );
      }

      console.log(
        `[ATTENDANCE_ENGINE] Lecturer ${lecturerId} started session room: ${attendanceRoomId}`,
      );
      activeSessions.set(lectureId, lecturerId);
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

      const closingLecture = (await findLectureDoc(lectureId))?.data() || null;
      if (
        !canRunAttendance(
          socket.data?.user?.uid,
          closingLecture,
          await findCourse(closingLecture?.courseId),
        )
      ) {
        socket.emit("error_response", {
          action: "end_attendance_session",
          message: "Only this lecture's lecturer can end attendance.",
        });
        return;
      }

      const attendanceRoomId = `lecture_attendance_${lectureId}`;
      console.log(
        `[ATTENDANCE_ENGINE] Closing session room: ${attendanceRoomId}`,
      );
      await AttendanceSessions.doc(String(lectureId)).delete().catch(() => {});
      const endedAt = new Date();
      const lectureQuery = await Lectures.where("id", "==", lectureId)
        .limit(1)
        .get();
      if (!lectureQuery.empty) {
        await lectureQuery.docs[0].ref.update({
          attendanceOpen: false,
          // Lets the lecturer's Classroom card show "Redo" instead of "Start".
          attendanceTakenAt: endedAt,
          updatedAt: new Date(),
        });
      } else {
        const lectureDocRef = Lectures.doc(lectureId);
        const lectureDoc = await lectureDocRef.get();
        if (lectureDoc.exists) {
          await lectureDocRef.update({
            attendanceOpen: false,
            attendanceTakenAt: endedAt,
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
        io.to(attendanceRoomId).socketsLeave(attendanceRoomId);
      });
      activeSessions.delete(lectureId);
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
      const { lectureId, identityProof, beaconCodes } = payload || {};
      // The student is whoever is signed in on this socket; a studentId in
      // the payload used to let anyone mark anyone present.
      const studentId = socket.data?.user?.uid;
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
      // The in-memory map only knows sessions started on this instance; with
      // several instances, fall back to the lecture's persisted flag.
      const sessionOpen =
        activeSessions.has(lectureId) ||
        !!(await findLectureDoc(lectureId))?.data()?.attendanceOpen;
      if (!sessionOpen) {
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
      const lecture = !lectureQuery.empty
        ? lectureQuery.docs[0].data()
        : (await findLectureDoc(lectureId))?.data() || null;

      const reject = (message) => {
        setImmediate(() =>
          logControllerPerformance(controllerName, action, startTime, "error", message),
        );
        return socket.emit("error", message);
      };

      // Enrolled in this lecture's course (which also keeps institutions apart).
      const course = await findCourse(lecture?.courseId);
      if (!lecture || !isEnrolled(studentId, course)) {
        return reject("You are not enrolled in this course.");
      }

      // Face match proof from /attendance/verify-student.
      const proof = verifyIdentityProof(identityProof, { uid: studentId, lectureId });
      if (!proof && faceProofRequired()) {
        return reject(
          "Your identity check has expired or is missing. Update iCampus and verify your face again.",
        );
      }

      // Rotating beacon code heard in the room (lecturer apps that rotate).
      const session = (await AttendanceSessions.doc(String(lectureId)).get()).data();
      const beaconVerified = session?.secret
        ? isFreshBeaconCode(beaconCodes, {
            secret: session.secret,
            lectureId: String(lectureId),
            windowSeconds: session.windowSeconds,
          })
        : null;
      if (beaconVerified === false) {
        return reject(
          "We couldn't confirm you're in the lecture room. Stay near your lecturer and try again.",
        );
      }

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
        // Server time: a client clock can be set to anything.
        timestamp: new Date(),
        createdAt: new Date(),
        identityMethod: proof?.method || "none",
        liveness: proof?.liveness || null,
        beaconVerified,
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
            timestamp: attendanceRecord.timestamp.toISOString(),
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