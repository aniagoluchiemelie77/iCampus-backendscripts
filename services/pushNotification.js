import { admin } from "../config/firebaseAdmin.js";
import { User } from "../tableDeclarations.js";

export const sendPushNotification = async (
  recipientId,
  title,
  body,
  data = {},
) => {
  try {
    const user = await User.findOne({ uid: recipientId });
    if (!user || !user.fcmToken) {
      console.log("No FCM token found for user:", recipientId);
      return;
    }
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: data,
      token: user.fcmToken,
    };
    const response = await admin.messaging().send(message);
    console.log("Push sent successfully:", response);
  } catch (error) {
    console.error("Error sending push notification:", error);
  }
};
