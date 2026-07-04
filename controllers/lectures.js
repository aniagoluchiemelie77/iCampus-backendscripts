import { User } from "../tableDeclarations.js";
import {
  pushToCloudStorage,
  checkDeepfakeDetectionAPI,
} from "../utils/firebaseUploader.js";
import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { logControllerPerformance } from "../utils/eventLogger.js";

export const uploadAndVerifyLessonVideo = async (req, res) => {
  const startTime = Date.now();
  const controllerName = "uploadAndVerifyLessonVideoController";
  const action = "uploadAndVerifyLessonVideo";
  try {
    if (!req.file) {
      logControllerPerformance(
        controllerName,
        action,
        startTime,
        "error",
        "No video payload discovered.",
      );
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
        logControllerPerformance(
          controllerName,
          action,
          startTime,
          "error",
          "File format parsing error.",
        );
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

      logControllerPerformance(controllerName, action, startTime, "success");
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
    logControllerPerformance(
      controllerName,
      action,
      startTime,
      "error",
      error.message,
    );
    return res
      .status(500)
      .json({ success: false, message: "Internal validation router fault." });
  }
};
