// services/pushNotificationService.js
import admin from 'firebase-admin';
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
import User from '../tableDeclarations.js'; // To fetch the token

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath),
});

const sendPushNotification = async (recipientId, title, body, data = {}) => {
  try {
    // 1. Find the user's device token from your DB
    const user = await User.findById(recipientId);
    if (!user || !user.fcmToken) {
      console.log("No FCM token found for user:", recipientId);
      return;
    }

    // 2. Construct the message
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data, // Custom data like { postId: '123' } for navigation
      token: user.fcmToken,
    };

    // 3. Send via Firebase
    const response = await admin.messaging().send(message);
    console.log('Push sent successfully:', response);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

module.exports = { sendPushNotification };