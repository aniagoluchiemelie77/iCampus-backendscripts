import admin from "firebase-admin";
import { User } from "../tableDeclarations.js";

export const sendPushNotification = async (
  recipientId,
  title,
  body,
  data = {},
) => {
  try {
    if (!recipientId) {
      console.warn("Push notification skipped: Missing recipientId.");
      return;
    }

    const querySnapshot = await User.where("uid", "==", recipientId)
      .limit(1)
      .get();

    if (querySnapshot.empty) {
      console.log("No user found for recipient:", recipientId);
      return;
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();

    if (!userData.fcmToken) {
      console.log("No FCM token found for user:", recipientId);
      return;
    }
    const sanitizedData = Object.fromEntries(
      Object.entries(data).map(([key, val]) => [key, String(val ?? "")]),
    );

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: sanitizedData,
      token: userData.fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log("Push sent successfully:", response);
  } catch (error) {
    console.error("Error sending push notification:", error.message);
    if (
      error.code === "messaging/registration-token-not-registered" ||
      error.code === "messaging/invalid-registration-token"
    ) {
      console.warn(
        `[FCM_CLEANUP] Removing stale token for recipient: ${recipientId}`,
      );
      try {
        const querySnapshot = await User.where("uid", "==", recipientId)
          .limit(1)
          .get();
        if (!querySnapshot.empty) {
          await querySnapshot.docs[0].ref.update({
            fcmToken: null,
            updatedAt: new Date(),
          });
        }
      } catch (cleanupError) {
        console.error(
          "[FCM_CLEANUP_FAILED] Could not remove stale token:",
          cleanupError.message,
        );
      }
    }
  }
};
