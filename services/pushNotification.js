import admin from "firebase-admin";
import { User } from "../tableDeclarations.js";

export const sendPushNotification = async (
  recipientId,
  title,
  body,
  data = {},
) => {
  try {
    const querySnapshot = await User
      .where("uid", "==", recipientId)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.log("No user found for recipient:", recipientId);
      return;
    }

    const userData = querySnapshot.docs[0].data();
    if (!userData.fcmToken) {
      console.log("No FCM token found for user:", recipientId);
      return;
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data,
      token: userData.fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent successfully:", response);
  } catch (error) {
    console.error("Error sending push notification:", error);
  }
};
