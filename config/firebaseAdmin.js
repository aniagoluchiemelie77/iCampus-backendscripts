import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (!admin.apps.length) {
  try {
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
      const serviceAccountPath = join(
        __dirname,
        "../secrets/serviceAccountKey.json",
      );
      const fileContent = readFileSync(serviceAccountPath, "utf8");
      serviceAccount = JSON.parse(fileContent);
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    console.log("Firebase Admin Initialized Successfully");
  } catch (error) {
    console.error("Firebase Initialization Error:", error.message);
  }
}

const storage = admin.storage();
const db = admin.firestore();
export { admin, storage, db };