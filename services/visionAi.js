import vision from '@google-cloud/vision';

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
});

export const scan = async (mediaUrls, textContent) => {
  const [result] = await client.safeSearchDetection(mediaUrls[0]);
  const detections = result.safeSearchAnnotation;
  const isViolation = 
    detections.adult === 'LIKELY' || 
    detections.adult === 'VERY_LIKELY' ||
    detections.racy === 'VERY_LIKELY';

  return {
    isViolation,
    flaggedCategory: isViolation ? 'Nudity/Explicit Content' : null,
    confidence: detections.adult 
  };
};