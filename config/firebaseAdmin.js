import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. Initialize only if not already initialized
if (!admin.apps.length) {
  try {
    const serviceAccountPath = join(__dirname, '../secrets/serviceAccountKey.json');
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
    
    console.log("Firebase Admin Initialized Successfully");
  } catch (error) {
    console.error("Firebase Initialization Error:", error.message);
    // Do not call process.exit(1) here if you want to keep the process alive
  }
}

const storage = admin.storage();
export { admin, storage };