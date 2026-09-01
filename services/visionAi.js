import vision from "@google-cloud/vision";
import dotenv from "dotenv";
dotenv.config();

let credentials;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
}
const client = new vision.ImageAnnotatorClient(
  credentials ? { credentials } : {},
);

export const scan = async (mediaUrls, textContent) => {
  if (!mediaUrls || mediaUrls.length === 0) return { isViolation: false };

  const [result] = await client.safeSearchDetection(mediaUrls[0]);
  const detections = result.safeSearchAnnotation;
  const isViolation =
    detections.adult === "LIKELY" ||
    detections.adult === "VERY_LIKELY" ||
    detections.racy === "VERY_LIKELY";

  return {
    isViolation,
    flaggedCategory: isViolation ? "Nudity/Explicit Content" : null,
    confidence: detections.adult,
  };
};
