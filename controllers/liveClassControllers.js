import { Lectures, Course } from "../tableDeclarations.js";
import { admin } from "../config/firebaseAdmin.js";
import { v4 as uuidv4 } from "uuid";
import { generateNotificationId } from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { DeepgramClient } from "@deepgram/sdk";
import { logControllerPerformance } from "../utils/eventLogger.js";
import { setImmediate } from "timers";
import agoraToken from "agora-token";

const { RtcTokenBuilder, RtcRole } = agoraToken;
const AGORA_TOKEN_TTL_SECONDS = 3 * 60 * 60;

/** Agora channel names: ≤64 chars of [A-Za-z0-9_-]. */
export const agoraChannelFor = (lectureId) =>
  `icampus_${String(lectureId).replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);

/** Stable numeric Agora uid (1 … 2^31-1) for an iCampus user id. */
export const agoraUidFor = (uid) => {
  let hash = 5381;
  const value = String(uid || "");
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return (hash % 2147483646) + 1;
};

const activeClassroomConnections = new Map();

// Lectures is a Firestore collection keyed by a custom `id` field, not the doc id.
const findLectureDoc = async (lectureId) => {
  const snap = await Lectures.where("id", "==", lectureId).limit(1).get();
  return snap.empty ? null : snap.docs[0];
};
const getLecture = async (lectureId) => {
  const doc = await findLectureDoc(lectureId);
  return doc ? doc.data() : null;
};
// Returns the merged lecture data, or null when the lecture does not exist.
const updateLecture = async (lectureId, updates) => {
  const doc = await findLectureDoc(lectureId);
  if (!doc) return null;
  await doc.ref.update(updates);
  return { ...doc.data(), ...updates };
};
const isSocketHost = (socket, lecture) =>
  !!socket.userProfile && socket.userProfile.uid === lecture?.hostId;

const getHostSockets = async (io, lectureId) => {
  const sockets = await io.in(`lecture_${lectureId}`).fetchSockets();
  return sockets.filter((s) => s.isLectureHost && s.lectureId === lectureId);
};

export const generateDeepgramToken = async () => {
  // Short-lived (60s) token: it only needs to outlive the WebSocket handshake.
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
  const grant = await deepgram.auth.v1.tokens.grant({ ttl_seconds: 60 });
  return grant.access_token;
};

export async function broadcastAttendeeList(io, lectureId) {
  const lectureRoomId = `lecture_${lectureId}`;
  const socketsInRoom = await io.in(lectureRoomId).fetchSockets();
  const uniqueStudentsMap = new Map();

  socketsInRoom.forEach((socketInstance) => {
    const profile = socketInstance.userProfile;
    if (profile && profile.uid) {
      uniqueStudentsMap.set(profile.uid, {
        uid: profile.uid,
        firstname: profile.firstname,
        lastname: profile.lastname,
        username: profile.username,
        tier: profile.tier,
        organizationName: profile.organizationName || "",
        profilePic: profile.profilePic,
      });
    }
  });

  const attendeePayloadList = Array.from(uniqueStudentsMap.values());
  io.to(lectureRoomId).emit("update_attendee_list", attendeePayloadList);
}
export const registerLectureStreamHandlers = (io, socket) => {
  socket.on("stream_ready", async (payload) => {
    const startTime = Date.now();
    const controllerName = "onlineClassStreamReadyController";
    const action = "onlineClassStreamReady";

    try {
      // Media flows over Agora; this only flips the lecture live.
      const { lectureId } = payload || {};
      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Missing invalid payload dependencies.",
          );
        });
        socket.emit("error_response", {
          action: "stream_ready",
          message: "Missing invalid payload dependencies.",
        });
        return;
      }

      const existingLecture = await getLecture(lectureId);
      if (existingLecture && !isSocketHost(socket, existingLecture)) {
        socket.emit("error_response", {
          action: "stream_ready",
          message: "Access Denied",
        });
        return;
      }
      const wasLive = existingLecture?.isLive === true;
      const updatedLecture = existingLecture
        ? await updateLecture(lectureId, {
            isLive: true,
            status: "ongoing",
            ...(wasLive ? {} : { startedAt: new Date() }),
          })
        : null;

      if (!updatedLecture) {
        console.warn(
          `[LIVE_CLASS_ENGINE] Stream initialization failed. Lecture id "${lectureId}" not found.`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture track reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "stream_ready",
          message: "Target lecture track reference could not be resolved.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      await socket.join(lectureRoomId);
      // Viewers already in the room re-request the stream on this event.
      io.to(lectureRoomId).emit("live_stream_started", {
        lectureId: updatedLecture.id,
        topicName: updatedLecture.topicName,
        status: updatedLecture.status,
        startedAt: updatedLecture.startedAt,
      });

      // First go-live only: ping enrolled students' personal rooms so their
      // home screen shows the "class is live" prompt (HomeScreen listens).
      if (!wasLive && updatedLecture.courseId) {
        const courseSnap = await Course.where(
          "courseId",
          "==",
          updatedLecture.courseId,
        )
          .limit(1)
          .get();
        const courseData = courseSnap.empty ? {} : courseSnap.docs[0].data();
        const studentUids = courseData.studentsEnrolled || [];
        studentUids.forEach((uid) =>
          io.to(String(uid)).emit("lecture_started", updatedLecture),
        );
        // The socket ping only reaches students with the app open; a push
        // brings everyone else straight into the class.
        setImmediate(() => {
          Promise.all(
            studentUids.map((uid) =>
              createNotification({
                notificationId: generateNotificationId("classroom"),
                recipientId: uid,
                isRead: false,
                category: "classroom",
                actionType: "LIVE_CLASS_STARTED",
                title: `${courseData.courseCode || "Your class"} is live now`,
                message: `"${updatedLecture.topicName || "Live class"}" has started. Tap to join.`,
                payload: {
                  lectureId: updatedLecture.id,
                  courseId: updatedLecture.courseId,
                  topicName: updatedLecture.topicName,
                },
                entityId: updatedLecture.id,
                entityType: "lecture",
                sendPush: true,
                sendSocket: false,
                saveToDb: true,
              }).catch((err) =>
                console.error(`[LIVE_CLASS_ENGINE] notify ${uid} failed:`, err.message),
              ),
            ),
          );
        });
      }

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      console.log(
        `[LIVE_CLASS_ENGINE] Live state synced cleanly for custom key id: ${lectureId}`,
      );
    } catch (error) {
      console.error(
        "[CORE_SOCKET_EXCEPTION] stream_ready handling failure:",
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
        action: "stream_ready",
        message: "Internal server synchronization failure encountered.",
      });
    }
  });
};
export const registerWebRTCSignalingHandlers = (io, socket) => {
  socket.on("webrtc_signal", async (payload) => {
    const startTime = Date.now();
    const controllerName = "onlineClassWebrtcSignalController";
    const action = "onlineClassWebrtcSignal";

    try {
      const { lectureId, signal } = payload || {};
      if (!lectureId || !signal) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload data",
          );
        });
        socket.emit("error_response", {
          action: "webrtc_signal",
          message: "Malformed payload data",
        });
        return;
      }

      if (!signal.type && !signal.candidate) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Invalid signaling payload.",
          );
        });
        socket.emit("error_response", {
          action: "webrtc_signal",
          message: "Invalid signaling payload.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      if (!socket.rooms.has(lectureRoomId)) {
        await socket.join(lectureRoomId);
      }

      // Each viewer has its own peer connection with the host, so offers,
      // answers and ICE candidates are addressed to a single socket.
      const { targetSocketId } = payload;
      const outbound = { lectureId, signal, senderId: socket.id };
      if (targetSocketId) {
        const target = io.sockets.sockets.get(targetSocketId);
        if (!target?.rooms.has(lectureRoomId)) return;
        target.emit("webrtc_signal_received", outbound);
      } else {
        socket.to(lectureRoomId).emit("webrtc_signal_received", outbound);
      }

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });
    } catch (error) {
      console.error(
        "[WEBRTC_SIGNALING_ERROR] Failed to safely proxy routing data:",
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
        action: "webrtc_signal",
        message:
          "Internal delivery pipeline failure during media configuration.",
      });
    }
  });

  // A viewer asks the host for a stream; the host then sends that viewer an offer.
  socket.on("webrtc_request_stream", async (payload) => {
    try {
      const { lectureId } = payload || {};
      if (!lectureId || socket.lectureId !== lectureId) return;
      const hostSockets = await getHostSockets(io, lectureId);
      hostSockets.forEach((hostSocket) =>
        hostSocket.emit("webrtc_viewer_joined", {
          lectureId,
          viewerSocketId: socket.id,
          viewerUid: socket.userProfile?.uid,
        }),
      );
    } catch (error) {
      console.error("[WEBRTC_REQUEST_STREAM_ERROR]", error.message);
    }
  });
};
export const registerAudioControlHandlers = (io, socket) => {
  socket.on("toggle_lecturer_mic", async (payload) => {
    const startTime = Date.now();
    const controllerName = "toggleMicController";
    const action = "toggleMic";

    try {
      const { lectureId, isMuted } = payload || {};
      if (!lectureId || typeof isMuted !== "boolean") {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload data.",
          );
        });
        socket.emit("error_response", {
          action: "toggle_lecturer_mic",
          message: "Malformed payload data.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit("lecturer_mic_status_changed", {
        lectureId,
        isMuted,
        updatedAt: new Date(),
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      console.log(
        `[AUDIO_ENGINE] Mic status synced for Room: ${lectureRoomId} | Muted: ${isMuted}`,
      );
    } catch (error) {
      console.error(
        "[AUDIO_CONTROL_ERROR] Failed to broadcast mic status:",
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
        action: "toggle_lecturer_mic",
        message: "Internal server failure handling audio state change.",
      });
    }
  });
};
export const registerScreenShareHandlers = (io, socket) => {
  socket.on("lecturer_started_sharing", async (payload) => {
    const startTime = Date.now();
    const controllerName = "lecturerShareScreenStartController";
    const action = "lecturerShareScreenStart";

    try {
      const { lectureId } = payload || {};
      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload data.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_started_sharing",
          message: "Malformed payload data.",
        });
        return;
      }

      const lecture = await getLecture(lectureId);
      if (lecture && !isSocketHost(socket, lecture)) {
        socket.emit("error_response", {
          action: "lecturer_started_sharing",
          message: "Access Denied",
        });
        return;
      }
      const updatedLecture = lecture
        ? await updateLecture(lectureId, { isScreenSharing: true })
        : null;

      if (!updatedLecture) {
        console.warn(
          `[SCREEN_SHARE_ENGINE] Execution failed. Lecture id "${lectureId}" not found.`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture track reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_started_sharing",
          message: "Target lecture track reference could not be resolved.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit("lecturer_screen_share_started", {
        lectureId,
        updatedAt: new Date(),
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      console.log(
        `[SCREEN_SHARE_ENGINE] Screen share track synchronized for Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[SCREEN_SHARE_ERROR] Failed to execute screen share tracking:",
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
        action: "lecturer_started_sharing",
        message: "Internal server failure handling screen share orchestration.",
      });
    }
  });
};
export const registerScreenShareStopHandlers = (io, socket) => {
  socket.on("lecturer_stopped_sharing", async (payload) => {
    const startTime = Date.now();
    const controllerName = "lecturerShareScreenStopController";
    const action = "lecturerShareScreenStop";

    try {
      const { lectureId } = payload || {};
      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload data.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_stopped_sharing",
          message: "Malformed payload data.",
        });
        return;
      }

      const lecture = await getLecture(lectureId);
      if (lecture && !isSocketHost(socket, lecture)) {
        socket.emit("error_response", {
          action: "lecturer_stopped_sharing",
          message: "Access Denied",
        });
        return;
      }
      const updatedLecture = lecture
        ? await updateLecture(lectureId, { isScreenSharing: false })
        : null;

      if (!updatedLecture) {
        console.warn(
          `[SCREEN_SHARE_ENGINE] Termination failed. Lecture id "${lectureId}" not found.`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture track reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_stopped_sharing",
          message: "Target lecture track reference could not be resolved.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.to(lectureRoomId).emit("lecturer_screen_share_stopped", {
        lectureId,
        updatedAt: new Date(),
      });

      console.log(
        `[SCREEN_SHARE_ENGINE] Screen share terminated cleanly for Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[SCREEN_SHARE_STOP_ERROR] Failed to execute stream breakdown:",
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
        action: "lecturer_stopped_sharing",
        message:
          "Internal server failure handling screen share cleanup operations.",
      });
    }
  });
};
export const registerChatHandlers = (io, socket) => {
  socket.on("send_message", async (payload) => {
    const startTime = Date.now();
    const controllerName = "onlineClassSendMessageController";
    const action = "onlineClassSendMessage";

    try {
      const { text, senderId, lectureId, username, profilePic } = payload || {};
      if (!lectureId || !senderId || !text || !text.trim()) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed message data payload components.",
          );
        });
        socket.emit("error_response", {
          action: "send_message",
          message: "Malformed message data payload components.",
        });
        return;
      }

      let sanitizedProfilePic = "";
      if (Array.isArray(profilePic)) {
        sanitizedProfilePic =
          profilePic.length > 0 ? profilePic[profilePic.length - 1] : "";
      } else if (typeof profilePic === "string") {
        sanitizedProfilePic = profilePic;
      }

      const newComment = {
        id: uuidv4(),
        // Trust the identity bound at join time over the payload.
        userId: socket.userProfile?.uid || senderId,
        username: username || "Anonymous User",
        profilePic: sanitizedProfilePic,
        text: text.trim().slice(0, 1000),
        timestamp: new Date(),
        likes: 0,
        replies: [],
      };

      const lectureDoc = await findLectureDoc(lectureId);
      if (lectureDoc) {
        await lectureDoc.ref.update({
          comments: admin.firestore.FieldValue.arrayUnion(newComment),
        });
      }

      if (!lectureDoc) {
        console.warn(
          `[CHAT_ENGINE] Message persistence failed. Lecture id "${lectureId}" not found.`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture track reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "send_message",
          message: "Target lecture track reference could not be resolved.",
        });
        return;
      }

      const savedComment = newComment;
      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      io.to(lectureRoomId).emit("receive_message", savedComment);
    } catch (error) {
      console.error(
        "[CHAT_ENGINE_ERROR] Failed to execute message processing:",
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
        action: "send_message",
        message: "Internal server failure handling message transmission.",
      });
    }
  });
};
export const registerNetworkFallbackHandlers = (io, socket) => {
  socket.on("lecturer_network_fallback", async (payload) => {
    const startTime = Date.now();
    const controllerName = "poorNetworkFallbackController";
    const action = "poorNetworkFallback";

    try {
      const { lectureId, mode } = payload || {};
      if (!lectureId || !mode) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload data.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_network_fallback",
          message: "Malformed payload data.",
        });
        return;
      }

      if (!["audio-only", "full-stream"].includes(mode)) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            'Invalid mode configuration. Expected "audio-only" or "full-stream".',
          );
        });
        socket.emit("error_response", {
          action: "lecturer_network_fallback",
          message:
            'Invalid mode configuration. Expected "audio-only" or "full-stream".',
        });
        return;
      }

      const isAudioOnly = mode === "audio-only";
      const currentLecture = await getLecture(lectureId);
      if (!currentLecture) {
        console.warn(
          `[NETWORK_ENGINE] Fallback processing failed. Lecture id "${lectureId}" not found.`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture track reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "lecturer_network_fallback",
          message: "Target lecture track reference could not be resolved.",
        });
        return;
      }

      if (!isSocketHost(socket, currentLecture)) {
        socket.emit("error_response", {
          action: "lecturer_network_fallback",
          message: "Access Denied",
        });
        return;
      }
      await updateLecture(lectureId, { isAudioOnly });

      const lectureRoomId = `lecture_${lectureId}`;
      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.to(lectureRoomId).emit("lecturer_network_mode_changed", {
        lectureId,
        mode,
        updatedAt: new Date(),
      });

      console.log(
        `[NETWORK_ENGINE] Adaptive stream shifted to [${mode}] for Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[NETWORK_FALLBACK_ERROR] Failed to execute network state broadcast:",
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
        action: "lecturer_network_fallback",
        message:
          "Internal server failure managing adaptive bit-stream transitions.",
      });
    }
  });
};
export const registerStudentInteractionHandlers = (io, socket) => {
  socket.on("student_waved", async (payload) => {
    const startTime = Date.now();
    const controllerName = "studentWaveActionController";
    const action = "studentWaveAction";

    try {
      const { uid, firstname, profilePic, lectureId } = payload || {};
      if (!lectureId || !uid || !firstname) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed interaction payload.",
          );
        });
        socket.emit("error_response", {
          action: "student_waved",
          message: "Malformed interaction payload.",
        });
        return;
      }

      let sanitizedProfilePic = "";
      if (Array.isArray(profilePic)) {
        sanitizedProfilePic =
          profilePic.length > 0 ? profilePic[profilePic.length - 1] : "";
      } else if (typeof profilePic === "string") {
        sanitizedProfilePic = profilePic;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.to(lectureRoomId).emit("student_waved_received", {
        uid,
        firstname,
        profilePic: sanitizedProfilePic,
        lectureId,
        timestamp: new Date(),
      });

      console.log(
        `[INTERACTION_ENGINE] Wave event proxied for User: ${firstname} (${uid}) in Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[INTERACTION_ENGINE_ERROR] Failed to process student wave event:",
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
        action: "student_waved",
        message:
          "Internal server failure handling interactive classroom signals.",
      });
    }
  });
};
export const registerSpeakerTrackingHandlers = (io, socket) => {
  socket.on("active_speaker_changed", async (payload) => {
    const startTime = Date.now();
    const controllerName = "activeSpeakerToggleController";
    const action = "activeSpeakerToggle";

    try {
      const { uid, firstname, lectureId } = payload || {};
      if (!lectureId || !uid || !firstname) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed speaker payload.",
          );
        });
        socket.emit("error_response", {
          action: "active_speaker_changed",
          message: "Malformed speaker payload.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.to(lectureRoomId).emit("active_speaker_changed_received", {
        uid,
        firstname,
        lectureId,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error(
        "[SPEAKER_ENGINE_ERROR] Failed to proxy active speaker update:",
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
        action: "active_speaker_changed",
        message: "Internal server failure handling live voice orchestration.",
      });
    }
  });

  socket.on("share_transcription_chunk", (payload) => {
    const { lectureId, speakerLabel, text } = payload || {};
    if (!lectureId) return;
    const lectureRoomId = `lecture_${lectureId}`;
    socket.to(lectureRoomId).emit("share_transcription_chunk", {
      speakerLabel,
      text,
    });
  });
};
export const registerAttendanceTrackingHandlers = (io, socket) => {
  // `ack` lets clients wait until they are in the room (and know their role)
  // before emitting host-only or room-scoped events.
  socket.on("join_lecture_session", async (payload, ack) => {
    const startTime = Date.now();
    const controllerName = "joinOnlineLectureSessionController";
    const action = "joinOnlineLectureSession";
    const reply = typeof ack === "function" ? ack : () => {};

    try {
      const { lectureId, user } = payload || {};
      if (!lectureId || !user || !user.uid) {
        reply({ ok: false, message: "Incomplete handshake profile dependencies." });
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Incomplete handshake profile dependencies.",
          );
        });
        socket.emit("error_response", {
          action: "join_lecture_session",
          message: "Incomplete handshake profile dependencies.",
        });
        return;
      }

      const lecture = await getLecture(lectureId);
      if (!lecture) {
        reply({ ok: false, message: "Lecture not found." });
        return;
      }
      if (lecture.status === "completed" || lecture.status === "cancelled") {
        reply({ ok: false, message: `This lecture is ${lecture.status}.` });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      // Host role comes from the lecture record, never from the client.
      const isHost = user.uid === lecture.hostId;
      socket.lectureId = lectureId;
      socket.userProfile = user;
      socket.isLectureHost = isHost;
      activeClassroomConnections.set(socket.id, { lectureId, isHost, ...user });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      await socket.join(lectureRoomId);
      await broadcastAttendeeList(io, lectureId);
      reply({ ok: true, isHost, isLive: lecture.isLive === true });

      const announcementMessage = isHost
        ? "Host has joined"
        : `${user.firstname} ${user.lastname} has joined`;

      io.to(lectureRoomId).emit("user_joined_announcement", {
        uid: user.uid,
        message: announcementMessage,
        isHost,
      });

      console.log(
        `[ATTENDANCE_ENGINE] ${user.firstname} successfully joined session: ${lectureId}`,
      );
    } catch (error) {
      console.error(
        "[ATTENDANCE_ERROR] Failed to mount student to session context:",
        error.message,
      );
      reply({ ok: false, message: "Could not join the live session." });
      setImmediate(() => {
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          error.message,
        );
      });
    }
  });

  socket.on("disconnect", async () => {
    try {
      const cachedSession = activeClassroomConnections.get(socket.id);

      if (cachedSession) {
        const { lectureId, firstname, lastname, uid, isHost } = cachedSession;
        activeClassroomConnections.delete(socket.id);
        await broadcastAttendeeList(io, lectureId);

        // Lets the host close this viewer's peer connection.
        io.to(`lecture_${lectureId}`).emit("webrtc_viewer_left", {
          viewerSocketId: socket.id,
        });
        io.to(`lecture_${lectureId}`).emit("user_left_announcement", {
          uid: uid,
          message: `${firstname} ${lastname} disconnected`,
          isHost: !!isHost,
        });

        console.log(
          `[ATTENDANCE_ENGINE] Connection dropped cleanly for ${firstname}. Syncing room.`,
        );
      }
    } catch (error) {
      console.error(
        "[ATTENDANCE_DISCONNECT_ERROR] Failed to reconcile room breakdown:",
        error.message,
      );
    }
  });
};
export const registerPermissionHandlers = (io, socket) => {
  socket.on("mic_permission_granted", async (payload) => {
    const startTime = Date.now();
    const controllerName = "grantMicPermissionController";
    const action = "grantMicPermission";

    try {
      const { lectureId, targetUid } = payload || {};
      if (!lectureId || !targetUid) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed permission payload.",
          );
        });
        socket.emit("error_response", {
          action: "mic_permission_granted",
          message: "Malformed permission payload.",
        });
        return;
      }

      const lectureDoc = await getLecture(lectureId);
      if (!lectureDoc) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "mic_permission_granted",
          message: "Target lecture reference could not be resolved.",
        });
        return;
      }

      const isAuthorizedHost =
        socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;
      if (!isAuthorizedHost) {
        console.warn(
          `[SECURITY_ALERT] Unauthorized floor mic permission request by socket ${socket.id} in lecture ${lectureId}`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access Denied",
          );
        });
        socket.emit("error_response", {
          action: "mic_permission_granted",
          message: "Access Denied",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      io.to(lectureRoomId).emit("mic_permission_granted_received", {
        lectureId,
        targetUid,
        timestamp: new Date(),
      });

      console.log(
        `[PERMISSION_ENGINE] Floor mic permission granted to student "${targetUid}" by host in Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[PERMISSION_ENGINE_ERROR] Failed to execute floor mic permission update:",
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
        action: "mic_permission_granted",
        message:
          "Internal server failure handling microphone permission handshakes.",
      });
    }
  });
};
export const registerLectureLifecycleHandlers = (io, socket) => {
  socket.on("end_lecture", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const startTime = Date.now();
    const controllerName = "endOnlineLectureSessionController";
    const action = "endOnlineLectureSession";

    try {
      const { lectureId } = payload || {};

      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed teardown payload.",
          );
        });
        reply({ ok: false, message: "Could not end the lecture." });
        socket.emit("error_response", {
          action: "end_lecture",
          message: "Malformed teardown payload.",
        });
        return;
      }

      const lectureDoc = await getLecture(lectureId);

      if (!lectureDoc) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture reference could not be resolved.",
          );
        });
        reply({ ok: false, message: "Could not end the lecture." });
        socket.emit("error_response", {
          action: "end_lecture",
          message: "Target lecture reference could not be resolved.",
        });
        return;
      }

      const isAuthorizedHost =
        socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;

      if (!isAuthorizedHost) {
        console.warn(
          `[SECURITY_ALERT] Unauthorized attempt to terminate lecture ${lectureId} by socket ${socket.id}`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access Denied",
          );
        });
        reply({ ok: false, message: "Could not end the lecture." });
        socket.emit("error_response", {
          action: "end_lecture",
          message: "Access Denied",
        });
        return;
      }

      const terminatedLecture = await updateLecture(lectureId, {
        isLive: false,
        isScreenSharing: false,
        status: "completed",
        isTaught: true,
        endedAt: new Date(),
        endTime: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      const lectureRoomId = `lecture_${lectureId}`;
      const socketsInRoom = await io.in(lectureRoomId).fetchSockets();
      const uniqueStudents = new Map();

      socketsInRoom.forEach((sInstance) => {
        const profile = sInstance.userProfile;
        if (profile && profile.uid && profile.uid !== lectureDoc.hostId) {
          uniqueStudents.set(profile.uid, profile);
        }
      });

      const reviewNotifications = Array.from(uniqueStudents.values()).map(
        (student) => {
          return createNotification({
            notificationId: generateNotificationId("classroom"),
            isRead: false,
            recipientId: student.uid,
            category: "classroom",
            actionType: "LECTURER_REVIEW_REQUEST",
            title: "Rate your lecture experience",
            message: `How was today's session on "${terminatedLecture?.topicName || "the lecture"}"? Rate your experience to help the iCampus community.`,
            payload: {
              lectureId: lectureId,
              topicName: terminatedLecture?.topicName || "",
              targetId: lectureDoc.hostId,
              targetType: "lecturer",
              userName: student.firstname || "Student",
            },
          }).catch((err) =>
            console.error(
              `[NOTIFICATION_ERR] Failed for user ${student.uid}:`,
              err.message,
            ),
          );
        },
      );

      Promise.all(reviewNotifications);

      socket.to(lectureRoomId).emit("lecture_ended_by_host", {
        lectureId,
        status: "completed",
        summary: {
          topicName: terminatedLecture?.topicName || "",
          totalComments: terminatedLecture?.comments
            ? terminatedLecture.comments.length
            : 0,
        },
      });

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socketsInRoom.forEach((socketInstance) => {
        socketInstance.leave(lectureRoomId);
      });

      console.log(
        `[LIFECYCLE_ENGINE] Lecture ${lectureId} concluded. Dispatched ${uniqueStudents.size} review requests.`,
      );
      reply({ ok: true });
    } catch (error) {
      console.error(
        "[LECTURE_TEARDOWN_ERROR] Failed to securely terminate live session:",
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

      reply({ ok: false, message: "Could not end the lecture." });
      socket.emit("error_response", {
        action: "end_lecture",
        message:
          "Internal server failure processing lecture termination cycles.",
      });
    }
  });
};
export const registerStudentLifecycleHandlers = (io, socket) => {
  socket.on("leave_lecture", async (payload) => {
    const startTime = Date.now();
    const controllerName = "leaveOnlineLectureSessionController";
    const action = "leaveOnlineLectureSession";

    try {
      const { lectureId, user } = payload || {};

      if (!lectureId || !user || !user.uid) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed departure payload.",
          );
        });
        socket.emit("error_response", {
          action: "leave_lecture",
          message: "Malformed departure payload.",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.leave(lectureRoomId);

      activeClassroomConnections.delete(socket.id);
      socket.lectureId = null;
      await broadcastAttendeeList(io, lectureId);
      io.to(lectureRoomId).emit("webrtc_viewer_left", {
        viewerSocketId: socket.id,
      });

      const leaveMessage =
        `${user.firstname || "A user"} ${user.lastname || ""} has left`.trim();
      io.to(lectureRoomId).emit("user_left_announcement", {
        uid: user.uid,
        message: leaveMessage,
        isHost: false,
      });

      console.log(
        `[LIFECYCLE_ENGINE] User ${user.uid} left lecture ${lectureId}`,
      );
    } catch (error) {
      console.error(
        "[STUDENT_LEAVE_ERROR] Failed to process departure:",
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
        action: "leave_lecture",
        message: "Internal server failure processing lecture departure.",
      });
    }
  });
};
export const registerPermissionRequestsHandlers = (io, socket) => {
  socket.on("grant_mic_permission", async (payload) => {
    const startTime = Date.now();
    const controllerName = "grantMicController";
    const action = "grantMic";

    try {
      const { lectureId, targetUid } = payload || {};

      if (!lectureId || !targetUid) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed permission payload.",
          );
        });
        socket.emit("error_response", {
          action: "grant_mic_permission",
          message: "Malformed permission payload.",
        });
        return;
      }

      const lectureDoc = await getLecture(lectureId);

      if (!lectureDoc) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "grant_mic_permission",
          message: "Target lecture reference could not be resolved.",
        });
        return;
      }

      const isAuthorizedHost =
        socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;

      if (!isAuthorizedHost) {
        console.warn(
          `[SECURITY_ALERT] Unauthorized floor management access bypass attempt by socket ${socket.id}`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access Denied",
          );
        });
        socket.emit("error_response", {
          action: "grant_mic_permission",
          message: "Access Denied",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      io.to(lectureRoomId).emit("mic_permission_granted_received", {
        lectureId,
        targetUid,
        timestamp: new Date(),
      });

      console.log(
        `[FLOOR_CONTROL] Voice token granted successfully to user ${targetUid} in Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[FLOOR_CONTROL_ERROR] Failed to execute mic assignment sequence:",
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
        action: "grant_mic_permission",
        message:
          "Internal server failure handling microphone token assignment.",
      });
    }
  });
};
export const registerMuteAllHandler = (io, socket) => {
  socket.on("revoke_all_mics", async (payload) => {
    const startTime = Date.now();
    const controllerName = "revokeAllMicsController";
    const action = "revokeAllMics";

    try {
      const { lectureId } = payload || {};

      if (!lectureId) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed payload.",
          );
        });
        socket.emit("error_response", {
          action: "revoke_all_mics",
          message: "Malformed payload.",
        });
        return;
      }

      const lectureDoc = await getLecture(lectureId);

      if (!lectureDoc) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target lecture reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "revoke_all_mics",
          message: "Target lecture reference could not be resolved.",
        });
        return;
      }

      const isAuthorizedHost =
        socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;

      if (!isAuthorizedHost) {
        console.warn(
          `[SECURITY_ALERT] Unauthorized mass-mute attempt by socket ${socket.id}`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access Denied",
          );
        });
        socket.emit("error_response", {
          action: "revoke_all_mics",
          message: "Access Denied",
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      io.to(lectureRoomId).emit("all_mics_revoked_received", {
        lectureId,
        timestamp: new Date(),
      });

      console.log(
        `[FLOOR_CONTROL] All audience microphones revoked in Room: ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[FLOOR_CONTROL_ERROR] Failed to execute mass-mute sequence:",
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
        action: "revoke_all_mics",
        message: "Internal server failure resetting floor speaking tokens.",
      });
    }
  });
};
/**
 * GET /v1/auth/agora-token?lectureId=…
 * Issues an Agora RTC token for a live class after checking the caller may
 * join. AGORA_APP_ID and AGORA_APP_CERTIFICATE stay on the server; the app
 * gets the App ID and a short-lived token from here.
 */
export const handleAgoraTokenGeneration = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "agoraTokenController";
  const action = "agoraToken";
  try {
    const appId = process.env.AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
      return res.status(503).json({
        success: false,
        message: "Live classes are not configured on the server yet.",
      });
    }
    const uid = req.user?.uid || req.user?.id;
    const lectureId = String(req.query.lectureId || "");
    if (!uid || !lectureId) {
      return res.status(400).json({ success: false, message: "lectureId is required." });
    }

    const lecture = await getLecture(lectureId);
    if (!lecture) {
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }
    if (["completed", "cancelled"].includes(lecture.status)) {
      return res.status(410).json({ success: false, message: "This class has ended." });
    }

    let course = null;
    if (lecture.courseId) {
      const courseSnap = await Course.where("courseId", "==", lecture.courseId)
        .limit(1)
        .get();
      course = courseSnap.empty ? null : courseSnap.docs[0].data();
    }
    const isHost =
      lecture.hostId === uid || (course?.lecturerIds || []).includes(uid);
    const isEnrolled = (course?.studentsEnrolled || []).includes(uid);
    // Quick public meetings have no course: any signed-in user may join.
    const isOpenMeeting = !lecture.courseId;
    if (!isHost && !isEnrolled && !isOpenMeeting) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this class.",
      });
    }

    const channel = agoraChannelFor(lecture.id || lectureId);
    const agoraUid = agoraUidFor(uid);
    // Everyone gets publisher rights so a student given the floor can speak
    // without a new token; the app joins students as audience until then.
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channel,
      agoraUid,
      RtcRole.PUBLISHER,
      AGORA_TOKEN_TTL_SECONDS,
      AGORA_TOKEN_TTL_SECONDS,
    );

    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "success"),
    );
    return res.status(200).json({
      success: true,
      appId,
      channel,
      uid: agoraUid,
      token,
      expiresIn: AGORA_TOKEN_TTL_SECONDS,
      isHost: lecture.hostId === uid,
      hostAgoraUid: agoraUidFor(lecture.hostId),
    });
  } catch (error) {
    console.error("Agora token error:", error.message);
    setImmediate(() =>
      logControllerPerformance(controllerName, action, startTime, "error", error.message),
    );
    return res.status(500).json({ success: false, message: "Could not start the live connection." });
  }
};

export const handleDeepgramTokenGeneration = async (req, res) => {
  try {
    const { lectureId } = req.query || {};
    if (!lectureId) {
      return res.status(400).json({
        success: false,
        message: "Missing parameter query context. lectureId is required.",
      });
    }

    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication tracking profiles failed validation checks.",
      });
    }

    const lectureCheck = await getLecture(lectureId);
    if (!lectureCheck) {
      return res.status(404).json({
        success: false,
        message: "Target live classroom session cannot be identified.",
      });
    }
    // Only the host and enrolled students may spend transcription credits.
    const uid = req.user.uid || req.user.id;
    let isParticipant = lectureCheck.hostId === uid;
    if (!isParticipant && lectureCheck.courseId) {
      const courseSnap = await Course.where(
        "courseId",
        "==",
        lectureCheck.courseId,
      )
        .limit(1)
        .get();
      const course = courseSnap.empty ? null : courseSnap.docs[0].data();
      isParticipant =
        !!course &&
        ((course.studentsEnrolled || []).includes(uid) ||
          (course.lecturerIds || []).includes(uid));
    }
    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this live session.",
      });
    }

    const token = await generateDeepgramToken();
    return res.status(200).json({ success: true, token });
  } catch (error) {
    console.error("[DEEPGRAM_KEY_BROKER_CRITICAL_ERROR]", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message:
          "Internal framework allocation error initializing transcription keys.",
      });
    }
  }
};
export const registerLecturerMediaControlHandlers = (io, socket) => {
  socket.on("toggle_lecturer_camera", async (payload) => {
    const startTime = Date.now();
    const controllerName = "toggleCameraController";
    const action = "toggleCamera";

    try {
      const { lectureId, isCameraOn } = payload || {};

      if (!lectureId || typeof isCameraOn !== "boolean") {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Malformed media control payload.",
          );
        });
        socket.emit("error_response", {
          action: "toggle_lecturer_camera",
          message: "Malformed media control payload.",
        });
        return;
      }

      const lectureDoc = await getLecture(lectureId);

      if (!lectureDoc) {
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Target live session reference could not be resolved.",
          );
        });
        socket.emit("error_response", {
          action: "toggle_lecturer_camera",
          message: "Target live session reference could not be resolved.",
        });
        return;
      }

      const isAuthorizedHost =
        socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;

      if (!isAuthorizedHost) {
        console.warn(
          `[SECURITY_ALERT] Unauthorized camera hardware channel state override modification attempt by: ${socket.id}`,
        );
        setImmediate(() => {
          logControllerPerformance(
            controllerName,
            action,
            startTime,
            "error",
            "Access Denied",
          );
        });
        socket.emit("error_response", {
          action: "toggle_lecturer_camera",
          message: "Access Denied",
        });
        return;
      }

      await updateLecture(lectureId, { isVideoActive: isCameraOn });

      const lectureRoomId = `lecture_${lectureId}`;

      setImmediate(() => {
        logControllerPerformance(controllerName, action, startTime, "success");
      });

      socket.to(lectureRoomId).emit("lecturer_camera_toggled_received", {
        lectureId,
        isCameraOn,
        timestamp: new Date(),
      });

      console.log(
        `[MEDIA_CONTROL] Lecturer video state updated to: [CameraOn: ${isCameraOn}] in room ${lectureRoomId}`,
      );
    } catch (error) {
      console.error(
        "[MEDIA_CONTROL_ERROR] Critical failure processing video channel pipeline toggle:",
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
        action: "toggle_lecturer_camera",
        message: "Internal server media orchestration track failure.",
      });
    }
  });
};

//Tested and trusted using jest