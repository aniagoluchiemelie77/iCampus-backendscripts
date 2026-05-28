import {
  Lectures,
  Exceptions,
  Attendance,
  User,
} from "../tableDeclarations.js";
import {
  pushToCloudStorage,
  checkDeepfakeDetectionAPI,
} from "../utils/firebaseUploader.js";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
const lectureRooms = new Map();

export const endLecture = async (lectureId) => {
  await Lectures.update({ id: lectureId }, { status: "completed" });
  const approvedExceptions = await Exceptions.find({
    lectureId,
    status: "approved",
  });
  const attendancePromises = approvedExceptions.map((ex) => {
    return Attendance.upsert({
      studentId: ex.studentId,
      lectureId: lectureId,
      status: "Present",
      remarks: "Verified via Approved Exceptions",
    });
  });
  await Promise.all(attendancePromises);
};
export const updateAttendeeList = (lectureId, user, action) => {
  if (!lectureRooms.has(lectureId)) {
    lectureRooms.set(lectureId, new Map());
  }

  const roomParticipants = lectureRooms.get(lectureId);

  if (action === "join") {
    roomParticipants.set(user.uid, {
      uid: user.uid,
      firstname: user.firstname,
      profilePic: user.profilePic,
      joinedAt: new Date(),
    });
  } else if (action === "leave") {
    roomParticipants.delete(user.uid);
  }
};

export const getAttendeesForRoom = (lectureId) => {
  const room = lectureRooms.get(lectureId);
  return room ? Array.from(room.values()) : [];
};
export const getGroupedAttendance = async (lectureId) => {
  return await Attendance.aggregate([
    { $match: { lectureId: lectureId } },
    {
      $lookup: {
        from: "users",
        localField: "studentId",
        foreignField: "uid",
        as: "studentInfo",
      },
    },
    { $unwind: "$studentInfo" },
    {
      $group: {
        _id: "$studentInfo.department",
        students: {
          $push: {
            firstname: "$studentInfo.firstname",
            lastname: "$studentInfo.lastname",
            matricNumber: "$studentInfo.matricNumber",
            timestamp: "$timestamp",
          },
        },
      },
    },
    { $sort: { _id: 1 } }, // Sort by Department Name
  ]);
};

export const uploadAndVerifyLessonVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No video payload discovered." });
    }

    const localFilePath = req.file.path;
    const creatorId = req.user.id;

    const creatorProfile = await User.findOne({ uid: creatorId });
    const accountAgeDays =
      (Date.now() - new Date(creatorProfile.createdAt).getTime()) /
      (1000 * 60 * 60 * 24);
    const isNewCreator = accountAgeDays < 4;

    ffmpeg.ffprobe(localFilePath, async (err, metadata) => {
      if (err) {
        if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
        return res
          .status(500)
          .json({ success: false, message: "File format parsing error." });
      }
      const { duration, size } = metadata.format;
      const dataDensityRatio = size / duration;
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === "video",
      );
      const tags = metadata.format.tags || {};
      const hasOrganicMetadata = !!(
        tags["com.apple.quicktime.make"] ||
        tags["com.android.version"] ||
        videoStream.codec_time_base
      );
      let verificationVerdict = "Approved";
      let escalationReason = "";
      if (duration > 30 && dataDensityRatio < 15000) {
        verificationVerdict = "Pending Review";
        escalationReason =
          "Suspiciously low variable video frame bitrate ratio.";
      }
      if (!hasOrganicMetadata) {
        verificationVerdict = "Pending Review";
        escalationReason = "Missing native device encoding tags.";
      }
      if (isNewCreator) {
        verificationVerdict = "Pending Review";
        escalationReason =
          "Account verification requirements for new profile listings.";
      }
      if (verificationVerdict === "Pending Review") {
        try {
          const deepfakeScore = await checkDeepfakeDetectionAPI(localFilePath);
          if (deepfakeScore > 0.85) {
            verificationVerdict = "Flagged/Rejected";
            escalationReason = `Automated AI analysis score exceeded critical boundaries: ${deepfakeScore}`;
          } else {
            verificationVerdict = "Approved";
          }
        } catch (apiError) {
          console.error(
            "Deepfake analytical API connectivity warning:",
            apiError.message,
          );
        }
      }
      let cloudStorageUrl = "";
      if (verificationVerdict !== "Flagged/Rejected") {
        cloudStorageUrl = await pushToCloudStorage(
          localFilePath,
          creatorProfile.uid,
          req.file.originalname,
        );
      }
      if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);

      return res.status(200).json({
        success: true,
        message:
          verificationVerdict === "Approved"
            ? "Video processed successfully."
            : `Listing marked: ${escalationReason}`,
        data: {
          permanentUrl: cloudStorageUrl,
          status: verificationVerdict,
          checks: { duration, size, dataDensityRatio, isNewCreator },
        },
      });
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res
      .status(500)
      .json({ success: false, message: "Internal validation router fault." });
  }
};

