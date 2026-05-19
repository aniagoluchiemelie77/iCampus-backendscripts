import { storage } from "../config/firebaseAdmin.js";
import { promises as fsPromises } from 'fs';
import axios from 'axios';
import fs from "fs";
import FormData from 'form-data';

export const pushToCloudStorage = async (localPath, creatorUid, originalName) => {
  const fileExtension = path.extname(originalName) || '.mp4';
  const uniqueVideoId = `video_${Date.now()}`;
  
  const bucket = storage.bucket(); 
  const destinationPath = `courses/lessons/${creatorUid}/${uniqueVideoId}${fileExtension}`;
  const file = bucket.file(destinationPath);

  await bucket.upload(localPath, {
    destination: destinationPath,
    public: true, 
    metadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000',
    },
  });

  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
};
export const checkDeepfakeDetectionAPI = async (filePath) => {
  try {
    const form = new FormData();
    form.append('media', fs.createReadStream(filePath));
    form.append('models', 'deepfake');
    form.append('api_user', process.env.SIGHTENGINE_API_USER);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET);

    const response = await axios.post('https://api.sightengine.com/1.0/check.json', form, {
      headers: {
        ...form.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    if (response.data && response.data.status === 'success') {
      const deepfakeData = response.data.deepfake;
      
      if (!deepfakeData || !deepfakeData.faces || deepfakeData.faces.length === 0) {
        return 0.0; 
      }
      const highestScore = Math.max(...deepfakeData.faces.map(face => face.score));
      return highestScore;
    }
    console.error('Deepfake vendor platform rejection warning:', response.data);
    return 0.5; 
  } catch (error) {
    console.error('Deepfake analytical API connection failure:', error.message);
    return 0.5; 
  }
};