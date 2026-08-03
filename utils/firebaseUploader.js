import { storage } from "../config/firebaseAdmin.js";
import axios from "axios";
import fs from "fs";

export const pushToCloudStorage = async (
  localPath,
  creatorUid,
  originalName,
) => {
  const fileExtension = path.extname(originalName) || ".mp4";
  const uniqueVideoId = `video_${Date.now()}`;

  const bucket = storage.bucket();
  const destinationPath = `courses/lessons/${creatorUid}/${uniqueVideoId}${fileExtension}`;
  const file = bucket.file(destinationPath);

  await bucket.upload(localPath, {
    destination: destinationPath,
    public: true,
    metadata: {
      contentType: "video/mp4",
      cacheControl: "public, max-age=31536000",
    },
  });

  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
};
