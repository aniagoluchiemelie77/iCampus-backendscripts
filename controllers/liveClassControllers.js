import {
  Lectures,
} from "../tableDeclarations.js";
import { v4 as uuidv4 } from 'uuid';
import {
  generateNotificationId,
} from "../utils/idGenerator.js";
import { createNotification } from "../services/notification.js";
import { createClient } from "@deepgram/sdk";

const activeClassroomConnections = new Map();

async function broadcastAttendeeList(io, lectureId) {
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
        profilePic: profile.profilePic
      });
    }
  });
  const attendeePayloadList = Array.from(uniqueStudentsMap.values());
  io.to(lectureRoomId).emit('update_attendee_list', attendeePayloadList);
}

export const registerLectureStreamHandlers = (io, socket) => {
  socket.on('stream_ready', async (payload) => {
    try {
      const { lectureId, streamUrl } = payload;
      if (!lectureId || !streamUrl) {
        socket.emit('error_response', { 
          action: 'stream_ready', 
          message: 'Missing invalid payload dependencies.' 
        });
        return;
      }
      const updatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId }, 
        {
          $set: {
            isLive: true,
            liveStreamUrl: streamUrl,
            status: 'ongoing', 
            startedAt: new Date(),
          }
        },
        { new: true } 
      );
      if (!updatedLecture) {
        console.warn(`[LIVE_CLASS_ENGINE] Stream initialization failed. Lecture id "${lectureId}" not found.`);
        socket.emit('error_response', {
          action: 'stream_ready',
          message: 'Target lecture track reference could not be resolved.',
        });
        return;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      await socket.join(lectureRoomId);
      io.to(lectureRoomId).emit('live_stream_started', {
        lectureId: updatedLecture.id,
        streamUrl: updatedLecture.liveStreamUrl,
        topicName: updatedLecture.topicName,
        status: updatedLecture.status,
        startedAt: updatedLecture.startedAt,
      });

      console.log(`[LIVE_CLASS_ENGINE] Live state synced cleanly for custom key id: ${lectureId}`);

    } catch (error) {
      console.error('[CORE_SOCKET_EXCEPTION] stream_ready handling failure:', error.message);
      
      socket.emit('error_response', {
        action: 'stream_ready',
        message: 'Internal server synchronization failure encountered.',
      });
    }
  });
};
export const registerWebRTCSignalingHandlers = (io, socket) => {
  socket.on('webrtc_signal', async (payload) => {
    try {
      const { lectureId, signal } = payload;
      if (!lectureId || !signal) {
        socket.emit('error_response', {
          action: 'webrtc_signal',
          message: 'Malformed payload data. lectureId and signal parameters are required.'
        });
        return;
      }
      if (!signal.type && !signal.candidate) {
        socket.emit('error_response', {
          action: 'webrtc_signal',
          message: 'Invalid signaling payload. Must contain a valid session description type or an ICE candidate.'
        });
        return;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      const connectedRooms = Array.from(socket.rooms);
      if (!connectedRooms.includes(lectureRoomId)) {
        await socket.join(lectureRoomId);
      }
      socket.to(lectureRoomId).emit('webrtc_signal_received', {
        lectureId,
        signal,
        senderId: socket.id, 
      });

    } catch (error) {
      console.error('[WEBRTC_SIGNALING_ERROR] Failed to safely proxy routing data:', error.message);
      
      socket.emit('error_response', {
        action: 'webrtc_signal',
        message: 'Internal delivery pipeline failure during media configuration.'
      });
    }
  });
};
export const registerAudioControlHandlers = (io, socket) => {
  socket.on('toggle_lecturer_mic', async (payload) => {
    try {
      const { lectureId, isMuted } = payload;
      if (!lectureId || typeof isMuted !== 'boolean') {
        socket.emit('error_response', {
          action: 'toggle_lecturer_mic',
          message: 'Malformed payload data. lectureId and isMuted (boolean) are required.'
        });
        return;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('lecturer_mic_status_changed', {
        lectureId,
        isMuted,
        updatedAt: new Date()
      });
      console.log(`[AUDIO_ENGINE] Mic status synced for Room: ${lectureRoomId} | Muted: ${isMuted}`);
    } catch (error) {
      console.error('[AUDIO_CONTROL_ERROR] Failed to broadcast mic status:', error.message);
      
      socket.emit('error_response', {
        action: 'toggle_lecturer_mic',
        message: 'Internal server failure handling audio state change.'
      });
    }
  });
};
export const registerScreenShareHandlers = (io, socket) => {
  socket.on('lecturer_started_sharing', async (payload) => {
    try {
      const { lectureId, streamId } = payload;
      if (!lectureId || !streamId) {
        socket.emit('error_response', {
          action: 'lecturer_started_sharing',
          message: 'Malformed payload data. lectureId and streamId parameters are required.'
        });
        return;
      }
      const updatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId },
        {
          $set: {
            liveStreamUrl: streamId, 
            status: 'ongoing'
          }
        },
        { new: true }
      );

      if (!updatedLecture) {
        console.warn(`[SCREEN_SHARE_ENGINE] Execution failed. Lecture id "${lectureId}" not found.`);
        socket.emit('error_response', {
          action: 'lecturer_started_sharing',
          message: 'Target lecture track reference could not be resolved.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('lecturer_screen_share_started', {
        lectureId,
        streamId,
        updatedAt: new Date()
      });

      console.log(`[SCREEN_SHARE_ENGINE] Screen share track synchronized for Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[SCREEN_SHARE_ERROR] Failed to execute screen share tracking:', error.message);
      
      socket.emit('error_response', {
        action: 'lecturer_started_sharing',
        message: 'Internal server failure handling screen share orchestration.'
      });
    }
  });
};
export const registerScreenShareStopHandlers = (io, socket) => {
  socket.on('lecturer_stopped_sharing', async (payload) => {
    try {
      const { lectureId } = payload;
      if (!lectureId) {
        socket.emit('error_response', {
          action: 'lecturer_stopped_sharing',
          message: 'Malformed payload data. lectureId parameter is required.'
        });
        return;
      }
      const updatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId },
        {
          $set: {
            liveStreamUrl: null 
          }
        },
        { new: true }
      );

      if (!updatedLecture) {
        console.warn(`[SCREEN_SHARE_ENGINE] Termination failed. Lecture id "${lectureId}" not found.`);
        socket.emit('error_response', {
          action: 'lecturer_stopped_sharing',
          message: 'Target lecture track reference could not be resolved.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('lecturer_screen_share_stopped', {
        lectureId,
        updatedAt: new Date()
      });

      console.log(`[SCREEN_SHARE_ENGINE] Screen share terminated cleanly for Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[SCREEN_SHARE_STOP_ERROR] Failed to execute stream breakdown:', error.message);
      
      socket.emit('error_response', {
        action: 'lecturer_stopped_sharing',
        message: 'Internal server failure handling screen share cleanup operations.'
      });
    }
  });
};
export const registerChatHandlers = (io, socket) => {
  socket.on('send_message', async (payload) => {
    try {
      const { text, senderId, lectureId, username, profilePic } = payload;
      if (!lectureId || !senderId || !text || !text.trim()) {
        socket.emit('error_response', {
          action: 'send_message',
          message: 'Malformed message data payload components.'
        });
        return;
      }
      let sanitizedProfilePic = '';
      if (Array.isArray(profilePic)) {
        sanitizedProfilePic = profilePic.length > 0 ? profilePic[profilePic.length - 1] : '';
      } else if (typeof profilePic === 'string') {
        sanitizedProfilePic = profilePic;
      }
      const newComment = {
        id: uuidv4(),
        userId: senderId,
        username: username || 'Anonymous User',
        profilePic: sanitizedProfilePic,
        text: text.trim(),
        timestamp: new Date(), 
        likes: 0,
        replies: [] 
      };
      const updatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId },
        { 
          $push: { comments: newComment } 
        },
        { 
          new: true,
          projection: { comments: { $slice: -1 } } 
        }
      );

      if (!updatedLecture) {
        console.warn(`[CHAT_ENGINE] Message persistence failed. Lecture id "${lectureId}" not found.`);
        socket.emit('error_response', {
          action: 'send_message',
          message: 'Target lecture track reference could not be resolved.'
        });
        return;
      }
      const savedComment = updatedLecture.comments[0];
      const lectureRoomId = `lecture_${lectureId}`;
      io.to(lectureRoomId).emit('receive_message', savedComment);
    } catch (error) {
      console.error('[CHAT_ENGINE_ERROR] Failed to execute message processing:', error.message);
      
      socket.emit('error_response', {
        action: 'send_message',
        message: 'Internal server failure handling message transmission.'
      });
    }
  });
};
export const registerNetworkFallbackHandlers = (io, socket) => {
  socket.on('lecturer_network_fallback', async (payload) => {
    try {
      const { lectureId, mode } = payload;
      if (!lectureId || !mode) {
        socket.emit('error_response', {
          action: 'lecturer_network_fallback',
          message: 'Malformed payload data. lectureId and mode parameters are required.'
        });
        return;
      }
      if (!['audio-only', 'full-stream'].includes(mode)) {
        socket.emit('error_response', {
          action: 'lecturer_network_fallback',
          message: 'Invalid mode configuration. Expected "audio-only" or "full-stream".'
        });
        return;
      }
      const isAudioOnly = mode === 'audio-only';
      const updatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId },
        {
          $set: {
            liveStreamUrl: isAudioOnly ? null : lecture.liveStreamUrl 
          }
        },
        { new: true }
      );

      if (!updatedLecture) {
        console.warn(`[NETWORK_ENGINE] Fallback processing failed. Lecture id "${lectureId}" not found.`);
        socket.emit('error_response', {
          action: 'lecturer_network_fallback',
          message: 'Target lecture track reference could not be resolved.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('lecturer_network_mode_changed', {
        lectureId,
        mode, 
        updatedAt: new Date()
      });
      console.log(`[NETWORK_ENGINE] Adaptive stream shifted to [${mode}] for Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[NETWORK_FALLBACK_ERROR] Failed to execute network state broadcast:', error.message);
      
      socket.emit('error_response', {
        action: 'lecturer_network_fallback',
        message: 'Internal server failure managing adaptive bit-stream transitions.'
      });
    }
  });
};
export const registerStudentInteractionHandlers = (io, socket) => {
  socket.on('student_waved', async (payload) => {
    try {
      const { uid, firstname, profilePic, lectureId } = payload;
      if (!lectureId || !uid || !firstname) {
        socket.emit('error_response', {
          action: 'student_waved',
          message: 'Malformed interaction payload. lectureId, uid, and firstname are required.'
        });
        return;
      }
      let sanitizedProfilePic = '';
      if (Array.isArray(profilePic)) {
        sanitizedProfilePic = profilePic.length > 0 ? profilePic[profilePic.length - 1] : '';
      } else if (typeof profilePic === 'string') {
        sanitizedProfilePic = profilePic;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('student_waved_received', {
        uid,
        firstname,
        profilePic: sanitizedProfilePic,
        lectureId,
        timestamp: new Date()
      });

      console.log(`[INTERACTION_ENGINE] Wave event proxied for User: ${firstname} (${uid}) in Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[INTERACTION_ENGINE_ERROR] Failed to process student wave event:', error.message);
      
      socket.emit('error_response', {
        action: 'student_waved',
        message: 'Internal server failure handling interactive classroom signals.'
      });
    }
  });
};
export const registerSpeakerTrackingHandlers = (io, socket) => {
  socket.on('active_speaker_changed', async (payload) => {
    try {
      const { uid, firstname, lectureId } = payload;
      if (!lectureId || !uid || !firstname) {
        socket.emit('error_response', {
          action: 'active_speaker_changed',
          message: 'Malformed speaker payload. lectureId, uid, and firstname are required.'
        });
        return;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      socket.to(lectureRoomId).emit('active_speaker_changed_received', {
        uid,
        firstname,
        lectureId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('[SPEAKER_ENGINE_ERROR] Failed to proxy active speaker update:', error.message);
      
      socket.emit('error_response', {
        action: 'active_speaker_changed',
        message: 'Internal server failure handling live voice orchestration.'
      });
    }
  });
};
export const registerAttendanceTrackingHandlers = (io, socket) => {
  socket.on('join_lecture_session', async (payload) => {
    try {
      const { lectureId, user } = payload; 
      if (!lectureId || !user || !user.uid) {
        socket.emit('error_response', {
          action: 'join_lecture_session',
          message: 'Incomplete handshake profile dependencies.'
        });
        return;
      }
      const lectureRoomId = `lecture_${lectureId}`;
      socket.lectureId = lectureId;
      socket.userProfile = user;
      activeClassroomConnections.set(socket.id, { lectureId, ...user });
      await socket.join(lectureRoomId);
      await broadcastAttendeeList(io, lectureId);
      console.log(`[ATTENDANCE_ENGINE] ${user.firstname} successfully joined session: ${lectureId}`);
    } catch (error) {
      console.error('[ATTENDANCE_ERROR] Failed to mount student to session context:', error.message);
    }
  });
  socket.on('disconnect', async () => {
    try {
      const cachedSession = activeClassroomConnections.get(socket.id);
      
      if (cachedSession) {
        const { lectureId, firstname } = cachedSession;
        activeClassroomConnections.delete(socket.id);
        await broadcastAttendeeList(io, lectureId);
        console.log(`[ATTENDANCE_ENGINE] Connection dropped cleanly for ${firstname}. Syncing room.`);
      }
    } catch (error) {
      console.error('[ATTENDANCE_DISCONNECT_ERROR] Failed to reconcile room breakdown:', error.message);
    }
  });
};
export const registerPermissionHandlers = (io, socket) => {
  socket.on('mic_permission_granted', async (payload) => {
    try {
      const { lectureId, targetUid } = payload;
      if (!lectureId || !targetUid) {
        socket.emit('error_response', {
          action: 'mic_permission_granted',
          message: 'Malformed permission payload. lectureId and targetUid are required.'
        });
        return;
      }
      const lectureDoc = await Lectures.findOne({ id: lectureId });
      
      if (!lectureDoc) {
        socket.emit('error_response', {
          action: 'mic_permission_granted',
          message: 'Target lecture reference could not be resolved.'
        });
        return;
      }
      const isAuthorizedHost = socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;
      if (!isAuthorizedHost) {
        console.warn(`[SECURITY_ALERT] Unauthorized floor mic permission request by socket ${socket.id} in lecture ${lectureId}`);
        socket.emit('error_response', {
          action: 'mic_permission_granted',
          message: 'Access Denied: Only the lecturer can grant microphone floor permissions.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      io.to(lectureRoomId).emit('mic_permission_granted_received', {
        lectureId,
        targetUid,
        timestamp: new Date()
      });

      console.log(`[PERMISSION_ENGINE] Floor mic permission granted to student "${targetUid}" by host in Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[PERMISSION_ENGINE_ERROR] Failed to execute floor mic permission update:', error.message);
      
      socket.emit('error_response', {
        action: 'mic_permission_granted',
        message: 'Internal server failure handling microphone permission handshakes.'
      });
    }
  });
};
export const registerLectureLifecycleHandlers = (io, socket) => {
  socket.on('end_lecture', async (payload) => {
    try {
      const { lectureId } = payload;
      
      if (!lectureId) {
        socket.emit('error_response', {
          action: 'end_lecture',
          message: 'Malformed teardown payload. lectureId parameter is required.'
        });
        return;
      }

      const lectureDoc = await Lectures.findOne({ id: lectureId });
      
      if (!lectureDoc) {
        socket.emit('error_response', {
          action: 'end_lecture',
          message: 'Target lecture reference could not be resolved.'
        });
        return;
      }

      const isAuthorizedHost = socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;
      
      if (!isAuthorizedHost) {
        console.warn(`[SECURITY_ALERT] Unauthorized attempt to terminate lecture ${lectureId} by socket ${socket.id}`);
        socket.emit('error_response', {
          action: 'end_lecture',
          message: 'Access Denied: Only the assigned host can terminate this session.'
        });
        return;
      }
      const terminatedLecture = await Lectures.findOneAndUpdate(
        { id: lectureId },
        {
          $set: {
            isLive: false,
            liveStreamUrl: null,
            status: 'completed', 
            isTaught: true,      
            endTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
          }
        },
        { new: true }
      );

      const lectureRoomId = `lecture_${lectureId}`;
      const socketsInRoom = await io.in(lectureRoomId).fetchSockets();
      const uniqueStudents = new Map();
      socketsInRoom.forEach((sInstance) => {
        const profile = sInstance.userProfile;
        if (profile && profile.uid && profile.uid !== lectureDoc.hostId) {
          uniqueStudents.set(profile.uid, profile);
        }
      });
      const reviewNotifications = Array.from(uniqueStudents.values()).map((student) => {
        return createNotification({
          notificationId: generateNotificationId("classroom"),
          recipientId: student.uid,
          category: "classroom",
          actionType: "LECTURER_REVIEW_REQUEST",
          title: "Rate your lecture experience",
          message: `How was today's session on "${terminatedLecture.topicName}"? Rate your experience to help the iCampus community.`,
          payload: {
            lectureId: lectureId,
            topicName: terminatedLecture.topicName,
            targetId: lectureDoc.hostId, 
            targetType: "lecturer",      
            userName: student.firstname || "Student",
          },
        }).catch(err => console.error(`[NOTIFICATION_ERR] Failed for user ${student.uid}:`, err.message));
      });
      Promise.all(reviewNotifications);
      socket.to(lectureRoomId).emit('lecture_ended_by_host', {
        lectureId,
        status: 'completed',
        summary: {
          topicName: terminatedLecture.topicName,
          totalComments: terminatedLecture.comments ? terminatedLecture.comments.length : 0
        }
      });
      socketsInRoom.forEach((socketInstance) => {
        socketInstance.leave(lectureRoomId);
      });

      console.log(`[LIFECYCLE_ENGINE] Lecture ${lectureId} concluded. Dispatched ${uniqueStudents.size} review requests.`);

    } catch (error) {
      console.error('[LECTURE_TEARDOWN_ERROR] Failed to securely terminate live session:', error.message);
      
      socket.emit('error_response', {
        action: 'end_lecture',
        message: 'Internal server failure processing lecture termination cycles.'
      });
    }
  });
};
export const registerPermissionRequestsHandlers = (io, socket) => {
  socket.on('grant_mic_permission', async (payload) => {
    try {
      const { lectureId, targetUid } = payload;
      if (!lectureId || !targetUid) {
        socket.emit('error_response', {
          action: 'grant_mic_permission',
          message: 'Malformed permission payload. lectureId and targetUid are required.'
        });
        return;
      }
      const lectureDoc = await Lectures.findOne({ id: lectureId });
      
      if (!lectureDoc) {
        socket.emit('error_response', {
          action: 'grant_mic_permission',
          message: 'Target lecture reference could not be resolved.'
        });
        return;
      }

      const isAuthorizedHost = socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;
      
      if (!isAuthorizedHost) {
        console.warn(`[SECURITY_ALERT] Unauthorized floor management access bypass attempt by socket ${socket.id}`);
        socket.emit('error_response', {
          action: 'grant_mic_permission',
          message: 'Access Denied: Only the instructor can assign floor speaking priorities.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      io.to(lectureRoomId).emit('mic_permission_granted_received', {
        lectureId,
        targetUid,
        timestamp: new Date()
      });

      console.log(`[FLOOR_CONTROL] Voice token granted successfully to user ${targetUid} in Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[FLOOR_CONTROL_ERROR] Failed to execute mic assignment sequence:', error.message);
      
      socket.emit('error_response', {
        action: 'grant_mic_permission',
        message: 'Internal server failure handling microphone token assignment.'
      });
    }
  });
};
export const registerMuteAllHandler = (io, socket) => {
  socket.on('revoke_all_mics', async (payload) => {
    try {
      const { lectureId } = payload;
      if (!lectureId) {
        socket.emit('error_response', {
          action: 'revoke_all_mics',
          message: 'Malformed payload. lectureId is required.'
        });
        return;
      }
      const lectureDoc = await Lectures.findOne({ id: lectureId });
      
      if (!lectureDoc) {
        socket.emit('error_response', {
          action: 'revoke_all_mics',
          message: 'Target lecture reference could not be resolved.'
        });
        return;
      }
      const isAuthorizedHost = socket.userProfile && socket.userProfile.uid === lectureDoc.hostId;
      
      if (!isAuthorizedHost) {
        console.warn(`[SECURITY_ALERT] Unauthorized mass-mute attempt by socket ${socket.id}`);
        socket.emit('error_response', {
          action: 'revoke_all_mics',
          message: 'Access Denied: Only the instructor can revoke floor permissions.'
        });
        return;
      }

      const lectureRoomId = `lecture_${lectureId}`;
      io.to(lectureRoomId).emit('all_mics_revoked_received', {
        lectureId,
        timestamp: new Date()
      });

      console.log(`[FLOOR_CONTROL] All audience microphones revoked in Room: ${lectureRoomId}`);

    } catch (error) {
      console.error('[FLOOR_CONTROL_ERROR] Failed to execute mass-mute sequence:', error.message);
      
      socket.emit('error_response', {
        action: 'revoke_all_mics',
        message: 'Internal server failure resetting floor speaking tokens.'
      });
    }
  });
};
export const handleDeepgramTokenGeneration = async (req, res) => {
  try {
    const { lectureId } = req.query;
    if (!lectureId) {
      return res.status(400).json({
        success: false,
        message: "Missing parameter query context. lectureId is required."
      });
    }
    if (!req.user || !req.user.uid) {
      return res.status(401).json({
        success: false,
        message: "Authentication tracking profiles failed validation checks."
      });
    }
    const lectureCheck = await Lectures.findOne({ id: lectureId });
    if (!lectureCheck) {
      return res.status(404).json({
        success: false,
        message: "Target live classroom session cannot be identified."
      });
    }
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
    const { result, error } = await deepgram.manage.createProjectKey(
      process.env.DEEPGRAM_PROJECT_ID,
      {
        comment: `iCampus Live Classroom Token - User: ${req.user.firstname} (${req.user.uid})`,
        scopes: ["usage:write"],        
        time_to_live_in_seconds: 60    
      }
    );

    if (error) {
      console.error("[DEEPGRAM_SDK_ERROR] Failed during remote key creation request:", error);
      throw new Error(error.message || "Deepgram remote infrastructure exception.");
    }
    return res.status(200).json({
      success: true,
      token: result.key
    });

  } catch (error) {
    console.error("[DEEPGRAM_KEY_BROKER_CRITICAL_ERROR]", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal framework allocation error initializing transcription keys."
    });
  }
};
